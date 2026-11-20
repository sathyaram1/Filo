// Le richieste di una finestra con nome che non caricano una pagina nuova (un collegamento a un'ancora, window.open
// senza indirizzo, focus) arrivano al main, che la porta davanti se c'è il clic (#737.8, tabs.js richiamataDallaPagina).
// Non decide niente: segnala soltanto. Prova: tests/finestra-della-pagina.spec.mjs.
'use strict';

const { SORGENTE: SEMBRA_NATIVA } = require('./sembraNativa.js');

const CANALE = 'filo:finestra-davanti';
const PER_NOME = 'filo:finestra-per-nome';
// I nomi che non indicano una finestra già aperta.
const SPECIALE = /^(?:_blank|_self|_parent|_top|_unfencedtop)?$/i;

function sorgente(principale) {
  return `(function(){'use strict';
  ${SEMBRA_NATIVA}
  var w = window, d = EventTarget.prototype.dispatchEvent, CE = CustomEvent, E = Event, SP = ${SPECIALE.toString()};
  var oOpen = w.open, oFocus = w.focus;
  if (typeof oOpen === 'function') {
    var open = maschera(function open(u, n) {
      var r = oOpen.apply(this == null ? w : this, arguments);
      try { if (r && n != null && !SP.test(String(n).trim())) d.call(w, new CE(${JSON.stringify(PER_NOME)}, { detail: String(n) })); } catch (e) {}
      return r;
    }, oOpen, 'open');
    Object.defineProperty(w, 'open', { value: open, writable: true, configurable: true, enumerable: true });
  }
  if (${principale ? 'true' : 'false'} && typeof oFocus === 'function') {
    var focus = maschera(function focus() {
      try { d.call(w, new E(${JSON.stringify(CANALE)})); } catch (e) {}
      return oFocus.apply(this == null ? w : this, arguments);
    }, oFocus, 'focus');
    Object.defineProperty(w, 'focus', { value: focus, writable: true, configurable: true, enumerable: true });
  }
  mascheraToString();
})()`;
}

function installa({ ipcRenderer, webFrame, sottoriquadro }) {
  const chiedi = (nome) => { try { ipcRenderer.send(CANALE, nome); } catch (_) {} };
  const daFocus = () => chiedi(null);
  const perNome = (e) => { if (e && typeof e.detail === 'string') chiedi(e.detail); };
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
    window.addEventListener('click', suClic, true);
    window.addEventListener(PER_NOME, perNome, true);
    if (!sottoriquadro) window.addEventListener(CANALE, daFocus, true);
  };
  ascolta();
  // La riscrittura da capo (document.open) toglie gli ascolti.
  try { new MutationObserver(ascolta).observe(document, { childList: true }); } catch (_) {}
  try { webFrame.executeJavaScript(sorgente(!sottoriquadro), false).catch(() => {}); } catch (_) {}
}

module.exports = { installa, CANALE };
