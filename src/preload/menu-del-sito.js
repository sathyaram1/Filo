// Il menu che un sito si disegna da sé (#975): una sonda nel mondo della pagina sa chi ascolta il tasto destro, senza
// che la pagina riceva l'evento; da qui si chiede, si rigioca il clic alla pagina e si guarda se un menu compare.
// La chiamano il ponte del tasto destro (page-preload.js) e content.js. Regole: patterns/menu-contestuale-se-filo-sostituisce-il-menu-nativo.md.
'use strict';

// Un menu nasce dove si è cliccato (spigolo sul cursore, o rovesciato contro il bordo): dentro questa distanza è suo.
const VICINO_PX = 32;
// Un menu caricato al primo uso (Docs) arriva tardi; oltre, la pagina il tasto l'ha solo annullato.
const ATTESA_MS = 1000;
const DISCENDENTI = 60;

// Il codice che gira nel mondo della pagina, prima dei suoi script. Segna chi si iscrive a `contextmenu` (una
// sostituta di addEventListener che a chi la ispeziona sembra nativa, come nella guardia anti-fingerprint) e risponde
// a due eventi dal nome segreto: «sul cammino di questo nodo qualcuno ascolta?» (preventDefault = sì) e «quello che
// ascoltava qui non ha mostrato niente» (da lì in poi non conta). React iscrive la sua radice a tutti gli eventi:
// conta solo se un elemento sul cammino ha davvero un onContextMenu. Lo stesso ascoltatore messo su finestra o documento
// per tanti eventi diversi (registratori di sessione, gli strumenti dei test) guarda i clic, non apre menu.
function sorgenteSonda(nome) {
  const n = JSON.stringify(String(nome));
  return `(function(){
  'use strict';
  var CHIEDI = ${n} + ':c', FALLITO = ${n} + ':f';
  var EP = typeof EventTarget === 'function' && EventTarget.prototype;
  if (!EP || typeof EP.addEventListener !== 'function') return;
  var oAdd = EP.addEventListener, oRem = EP.removeEventListener;
  var ascolti = new WeakMap();
  var falliti = new WeakSet();
  var tipiDi = new WeakMap();
  var TIPI_GENERICO = 8;
  var DOC = typeof document !== 'undefined' ? document : null;
  var mascherate = new WeakMap();
  function maschera(fn, orig, name) {
    var m = fn;
    try {
      m = ({ [name]() { return fn.apply(this, arguments); } })[name];
      Object.defineProperty(m, 'length', { value: orig.length, configurable: true });
      mascherate.set(m, 'function ' + name + '() { [native code] }');
    } catch (e) {}
    return m;
  }
  function fase(o) { return (o === true || (o && typeof o === 'object' && o.capture)) ? 2 : 1; }
  function togli(t, f, o) {
    var m = ascolti.get(t);
    if (!m || !m.has(f)) return;
    var b = m.get(f) & ~fase(o);
    if (b) m.set(f, b); else m.delete(f);
  }
  function contaTipo(t, tipo, f) {
    if ((t !== window && t !== DOC) || !f || (typeof f !== 'function' && typeof f !== 'object') || typeof tipo !== 'string') return;
    var v = tipiDi.get(f);
    if (v === undefined) tipiDi.set(f, tipo);
    else if (typeof v === 'string') { if (v !== tipo) tipiDi.set(f, new Set([v, tipo])); }
    else v.add(tipo);
  }
  function generico(f) {
    var v = tipiDi.get(f);
    return !!v && typeof v !== 'string' && v.size >= TIPI_GENERICO;
  }
  function segna(t, tipo, f, o) {
    contaTipo(t, tipo, f);
    if (tipo !== 'contextmenu' || !f || (typeof f !== 'function' && typeof f !== 'object')) return;
    var s = o && typeof o === 'object' ? o.signal : null;
    if (s && s.aborted === true) return;
    var m = ascolti.get(t);
    if (!m) { m = new Map(); ascolti.set(t, m); }
    m.set(f, (m.get(f) || 0) | fase(o));
    if (s && typeof s.aborted === 'boolean') oAdd.call(s, 'abort', function () { togli(t, f, o); }, { once: true });
  }
  try {
    EP.addEventListener = maschera(function addEventListener(tipo, f, o) {
      try { segna(this == null ? window : this, tipo, f, o); } catch (e) {}
      return oAdd.apply(this, arguments);
    }, oAdd, 'addEventListener');
    EP.removeEventListener = maschera(function removeEventListener(tipo, f, o) {
      try { if (tipo === 'contextmenu') togli(this == null ? window : this, f, o); } catch (e) {}
      return oRem.apply(this, arguments);
    }, oRem, 'removeEventListener');
    var FP = Function.prototype, oStr = FP.toString;
    FP.toString = maschera(function toString() {
      return (typeof this === 'function' && mascherate.get(this)) || oStr.apply(this, arguments);
    }, oStr, 'toString');
  } catch (e) {}

  function chiavi(nodo) { try { return Object.keys(nodo); } catch (e) { return []; } }
  function radiceReact(nodo) {
    if (!nodo || typeof nodo !== 'object' || !nodo.nodeType) return false;
    var ks = chiavi(nodo);
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i];
      if (k.indexOf('__reactContainer$') === 0 || k === '_reactRootContainer') return true;
      if (nodo.nodeType === 1 && k.indexOf('_reactListening') === 0) return true;
    }
    return false;
  }
  function reactConGestore(cammino) {
    for (var i = 0; i < cammino.length; i++) {
      var nodo = cammino[i];
      if (!nodo || nodo.nodeType !== 1) continue;
      var ks = chiavi(nodo);
      for (var j = 0; j < ks.length; j++) {
        if (ks[j].indexOf('__reactProps$') !== 0 && ks[j].indexOf('__reactEventHandlers$') !== 0) continue;
        var p = nodo[ks[j]];
        if (p && (typeof p.onContextMenu === 'function' || typeof p.onContextMenuCapture === 'function')) return true;
      }
    }
    return false;
  }
  // L'altra porta standard: il gestore oncontextmenu, assegnato da script o scritto come attributo nell'HTML.
  function gestore(nodo) {
    try { return typeof nodo.oncontextmenu === 'function'; } catch (e) { return false; }
  }
  function chiAscolta(cammino) {
    var react = null;
    for (var i = 0; i < cammino.length; i++) {
      var nodo = cammino[i];
      if (!nodo || falliti.has(nodo)) continue;
      if (gestore(nodo)) return nodo;
      var m = ascolti.get(nodo);
      if (!m || !m.size) continue;
      if (nodo === window || nodo === DOC) {
        var proprio = false;
        m.forEach(function (_b, f) { if (!generico(f)) proprio = true; });
        if (!proprio) continue;
      }
      if (radiceReact(nodo)) {
        if (react === null) react = reactConGestore(cammino);
        if (!react) continue;
      }
      return nodo;
    }
    return null;
  }
  function rispondi() {
    oAdd.call(window, CHIEDI, function (e) {
      try { e.stopImmediatePropagation(); if (chiAscolta(e.composedPath())) e.preventDefault(); } catch (x) {}
    }, true);
    oAdd.call(window, FALLITO, function (e) {
      try { e.stopImmediatePropagation(); var nodo = chiAscolta(e.composedPath()); if (nodo) falliti.add(nodo); } catch (x) {}
    }, true);
  }
  rispondi();
  // document.open() toglie gli ascoltatori di finestra e documento, i nostri e quelli della pagina.
  try {
    var radice = document.documentElement;
    new MutationObserver(function () {
      if (document.documentElement === radice) return;
      radice = document.documentElement;
      ascolti.delete(window);
      ascolti.delete(document);
      rispondi();
    }).observe(document, { childList: true });
  } catch (e) {}
})();`;
}

// La copia inerte di un tasto destro, da consegnare al menu di Filo dopo che l'evento è finito: consegnato,
// composedPath() torna vuoto, quindi l'elemento vero (anche dentro uno shadow root) si fotografa subito.
function copiaDelClic(e) {
  let node = null;
  try { node = (typeof e.composedPath === 'function' && e.composedPath()[0]) || e.target; } catch (_) { node = e.target; }
  return {
    target: node,
    currentTarget: node,
    clientX: e.clientX, clientY: e.clientY,
    pageX: e.pageX, pageY: e.pageY,
    screenX: e.screenX, screenY: e.screenY,
    button: e.button,
    shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey,
    defaultPrevented: false,
    composedPath: () => (node ? [node] : []),
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
  };
}

function crea({ webFrame, riserva = () => {}, finestra = globalThis.window, nome = null } = {}) {
  // Web Crypto, non node:crypto: nella sandbox del preload Node non c'è (#834).
  const segreto = nome || `x${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  try { webFrame.executeJavaScript(sorgenteSonda(segreto), false).catch(() => {}); } catch (_) {}
  const doc = () => finestra.document;

  function chiedi(suffisso, nodo) {
    if (!nodo || typeof nodo.dispatchEvent !== 'function') return false;
    try {
      return !nodo.dispatchEvent(new finestra.CustomEvent(segreto + suffisso, { bubbles: false, composed: true, cancelable: true }));
    } catch (_) { return false; }
  }

  const nostro = (el) => {
    try { return !!globalThis.SN_FILO_UI?.inside?.(el); } catch (_) { return false; }
  };

  function vicinoEVisibile(el, x, y) {
    let r;
    try { r = el.getBoundingClientRect(); } catch (_) { return false; }
    if (!r || r.width < 8 || r.height < 8) return false;
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    if (dx > VICINO_PX || dy > VICINO_PX) return false;
    try {
      const cs = finestra.getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    } catch (_) { return false; }
  }

  // Il nodo toccato o uno dei suoi primi discendenti (un portale vuoto col menu dentro) ora sta sotto il cursore.
  function comparsoIn(el, x, y) {
    const d = doc();
    if (!el || el.nodeType !== 1 || el === d.documentElement || el === d.body || nostro(el)) return false;
    if (vicinoEVisibile(el, x, y)) return true;
    let walker;
    try { walker = d.createTreeWalker(el, 1); } catch (_) { return false; }
    for (let i = 0; i < DISCENDENTI && walker.nextNode(); i++) {
      if (vicinoEVisibile(walker.currentNode, x, y)) return true;
    }
    return false;
  }

  // Si accende PRIMA di dare il clic alla pagina: il menu può nascere dentro il suo ascoltatore.
  function aspettaMenu(x, y, entro = ATTESA_MS) {
    let fine;
    const esito = new Promise((r) => { fine = r; });
    let chiuso = false;
    let mo = null;
    let timer = null;
    const chiudi = (v) => {
      if (chiuso) return;
      chiuso = true;
      try { if (mo) mo.disconnect(); } catch (_) {}
      clearTimeout(timer);
      fine(v);
    };
    try {
      mo = new finestra.MutationObserver((ms) => {
        if (chiuso) return;
        for (const m of ms) {
          const nodi = m.type === 'childList' ? m.addedNodes : [m.target];
          for (const n of nodi) if (comparsoIn(n, x, y)) { chiudi(true); return; }
        }
      });
      mo.observe(doc(), {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'open', 'aria-hidden', 'aria-expanded'],
      });
    } catch (_) { chiudi(false); }
    timer = setTimeout(() => chiudi(false), entro);
    return { esito, ferma: () => chiudi(false) };
  }

  return {
    copiaDelClic,

    // Sul cammino di questo nodo la pagina ascolta il tasto destro? (La pagina non riceve niente.)
    ascolta(nodo) {
      return !!(nodo && nodo.isConnected) && chiedi(':c', nodo);
    },

    // «Menu di <sito>» (#975): lo stesso tasto destro, ora per la pagina, nello stesso punto. Se il sito lo annulla
    // e un menu suo compare → 'menu'. Altrimenti la pagina non ha un menu suo lì: compare quello del browser, come
    // con Shift, e chi ascoltava non conta più → 'niente' (non l'ha annullato) o 'vuoto' (l'ha solo annullato).
    async apri(s) {
      const d = doc();
      let nodo = s && s.nodo && s.nodo.isConnected ? s.nodo : null;
      if (!nodo) { try { nodo = d.elementFromPoint(s.x, s.y); } catch (_) { nodo = null; } }
      if (!nodo || nostro(nodo)) nodo = d.body || d.documentElement;
      const attesa = aspettaMenu(s.x, s.y);
      let annullato = false;
      try {
        annullato = !nodo.dispatchEvent(new finestra.MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, composed: true, view: finestra,
          clientX: s.x, clientY: s.y, screenX: s.sx, screenY: s.sy,
          ctrlKey: !!s.ctrlKey, altKey: !!s.altKey, metaKey: !!s.metaKey, shiftKey: false,
          button: 2, buttons: 0,
        }));
      } catch (_) { annullato = false; }
      if (!annullato) attesa.ferma();
      if (annullato && await attesa.esito) return 'menu';
      chiedi(':f', nodo);
      riserva(s.clic);
      return annullato ? 'vuoto' : 'niente';
    },

    // Col menu del sito al primo posto il tasto destro va alla pagina. Se non lo annulla, o lo annulla senza mostrare
    // niente, si apre quello di Filo: un tasto destro apre sempre un menu.
    lasciaAllaPagina(e, apriFilo) {
      const copia = copiaDelClic(e);
      const attesa = aspettaMenu(e.clientX, e.clientY);
      setTimeout(async () => {
        if (!e.defaultPrevented) { attesa.ferma(); apriFilo(copia); return; }
        if (!(await attesa.esito)) apriFilo(copia);
      }, 0);
    },
  };
}

module.exports = { crea, copiaDelClic, sorgenteSonda, VICINO_PX, ATTESA_MS };
