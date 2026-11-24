// Le richieste della pagina per una finestra che tiene, quando non caricano una pagina nuova (un collegamento a
// un'ancora, window.open senza indirizzo, focus, il pulsante che l'ha aperta premuto di nuovo), arrivano al main, che la
// porta davanti se c'è il clic (#737.8, tabs.js richiamataDallaPagina). Non decide niente: segnala soltanto.
'use strict';

const { SORGENTE: SEMBRA_NATIVA } = require('./sembraNativa.js');

const CANALE = 'filo:finestra-davanti';
const PER_NOME = 'filo:finestra-per-nome';
const APERTA = 'filo:finestra-aperta';
const PER_FOCUS = 'filo:finestra-focus';
// I nomi che non indicano una finestra già aperta.
const SPECIALE = /^(?:_blank|_self|_parent|_top|_unfencedtop)?$/i;
// Gli eventi dell'utente dentro cui una richiesta della pagina è sua (#737.13).
const GESTI = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'keydown', 'keypress', 'keyup', 'touchend'];
const AZIONABILE = 'a[href],area[href],button,input,select,summary,label,[role=button],[role=link],[role=menuitem],[onclick]';
// Il pulsante premuto di nuovo chiede la finestra solo se intanto la pagina non ne apre, né chiude, un'altra.
const RIPETUTO_MS = 200;

function sorgente(principale) {
  return `(function(){'use strict';
  ${SEMBRA_NATIVA}
  var w = window, d = EventTarget.prototype.dispatchEvent, CE = CustomEvent, SP = ${SPECIALE.toString()}, U = URL, doc = document, J = JSON;
  var oOpen = w.open, oFocus = w.focus, op = null;
  try { op = w.opener; } catch (e) {}
  if (typeof oOpen === 'function') {
    var open = maschera(function open(u, n) {
      var r = oOpen.apply(this == null ? w : this, arguments);
      try {
        var nome = n == null || SP.test(String(n).trim()) ? '' : String(n);
        if (r && nome) d.call(w, new CE(${JSON.stringify(PER_NOME)}, { detail: nome }));
        var dove = '';
        try { if (u != null && String(u) !== '') dove = new U(String(u), doc.baseURI).href; } catch (e) {}
        if (r) d.call(w, new CE(${JSON.stringify(APERTA)}, { detail: J.stringify({ nome: nome, url: dove }) }));
      } catch (e) {}
      return r;
    }, oOpen, 'open');
    Object.defineProperty(w, 'open', { value: open, writable: true, configurable: true, enumerable: true });
  }
  // Il focus lo sente il frame che ha aperto la finestra, se è del suo stesso sito: lì si sa se lo chiede dentro un clic.
  if (${principale ? 'true' : 'false'} && typeof oFocus === 'function') {
    var focus = maschera(function focus() {
      try { if (op) d.call(op, new CE(${JSON.stringify(PER_FOCUS)}, { detail: J.stringify({ nome: String(w.name || ''), url: String(w.location.href) }) })); } catch (e) {}
      return oFocus.apply(this == null ? w : this, arguments);
    }, oFocus, 'focus');
    Object.defineProperty(w, 'focus', { value: focus, writable: true, configurable: true, enumerable: true });
  }
  mascheraToString();
})()`;
}

const leggi = (e) => {
  if (!e || typeof e.detail !== 'string') return null;
  try {
    const r = JSON.parse(e.detail);
    return r && typeof r === 'object' ? { nome: String(r.nome || '').slice(0, 1024), url: String(r.url || '').slice(0, 8192) } : null;
  } catch (_) { return null; }
};

function installa({ ipcRenderer, webFrame }) {
  const chiedi = (richiesta) => { try { ipcRenderer.send(CANALE, richiesta); } catch (_) {} };
  // Una richiesta della pagina è sua se arriva mentre un evento vero dell'utente sta ancora viaggiando nel suo frame:
  // un evento finito ha la fase a zero, e né la pagina né un'altra finestra possono fingerne uno.
  const veri = [];
  const inViaggio = () => veri.find((v) => v.ev.eventPhase !== 0) || null;
  // Le finestre aperte dentro un clic, col pulsante che le ha aperte.
  const aperte = [];
  let ripetuto = null;
  const azionabile = (e) => {
    const percorso = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    const el = percorso.find((n) => n && n.nodeType === 1 && typeof n.matches === 'function' && n.matches(AZIONABILE));
    return el || (percorso[0] && percorso[0].nodeType === 1 ? percorso[0] : null);
  };
  const suGesto = (e) => {
    if (!e.isTrusted) return;
    const el = azionabile(e);
    veri.push({ ev: e, el });
    if (veri.length > 12) veri.shift();
    if (e.type !== 'click' || !el) return;
    const a = aperte.find((x) => x.el.deref() === el);
    if (!a) return;
    const questo = { annullato: false };
    ripetuto = questo;
    setTimeout(() => {
      if (ripetuto === questo) ripetuto = null;
      if (!questo.annullato) chiedi({ ripetuto: true, nome: a.nome, url: a.url });
    }, RIPETUTO_MS);
  };
  const annulla = () => { if (ripetuto) ripetuto.annullato = true; };
  const perNome = (e) => {
    annulla();
    if (e && typeof e.detail === 'string') chiedi(e.detail);
  };
  const suAperta = (e) => {
    annulla();
    const r = leggi(e);
    const g = inViaggio();
    if (!r || !g || !g.el) return;
    const i = aperte.findIndex((x) => x.el.deref() === g.el || !x.el.deref());
    if (i >= 0) aperte.splice(i, 1);
    aperte.push({ el: new WeakRef(g.el), nome: r.nome, url: r.url });
    if (aperte.length > 16) aperte.shift();
  };
  const perFocus = (e) => {
    const r = leggi(e);
    if (!r || !inViaggio()) return;
    annulla();
    chiedi({ focus: true, nome: r.nome, url: r.url });
  };
  // Il clic normale su un collegamento che punta a una finestra con nome; Ctrl, Maiuscolo e la rotella aprono altrove.
  const suClic = (e) => {
    if (!e.isTrusted || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const percorso = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    const a = percorso.find((n) => n && (n.localName === 'a' || n.localName === 'area') && n.hasAttribute && n.hasAttribute('href'));
    if (!a) return;
    let nome = a.getAttribute('target');
    if (nome == null) {
      const base = a.ownerDocument && a.ownerDocument.querySelector('base[target]');
      nome = base ? base.getAttribute('target') : '';
    }
    if (SPECIALE.test(String(nome || '').trim())) return;
    setTimeout(() => { if (!e.defaultPrevented) chiedi(nome); }, 0);
  };
  const ascolta = () => {
    for (const tipo of GESTI) window.addEventListener(tipo, suGesto, true);
    window.addEventListener('click', suClic, true);
    window.addEventListener(PER_NOME, perNome, true);
    window.addEventListener(APERTA, suAperta, true);
    window.addEventListener(PER_FOCUS, perFocus, true);
  };
  ascolta();
  // La riscrittura da capo (document.open) toglie gli ascolti.
  try { new MutationObserver(ascolta).observe(document, { childList: true }); } catch (_) {}
  try { webFrame.executeJavaScript(sorgente(!webFrame.parent), false).catch(() => {}); } catch (_) {}
}

module.exports = { installa, CANALE };
