// Il menu che un sito ha per il tasto destro (#975): il mondo della pagina dice se sul punto cliccato il sito ascolta il
// tasto destro e annulla il menu del browser, senza lasciargli disegnare niente; il ponte del page-preload gli passa il
// clic quando l'utente lo chiede. Regole: patterns/il-menu-del-sito-e-una-voce-di-filo.md; prove: tests/menu-del-sito.spec.mjs.

// Quanto resta valido «il prossimo tasto destro è del sito», dalla voce al clic rigirato dal main.
const PASSAGGIO_MS = 1500;
// Quanto si aspetta che il sito, annullato il menu del browser, mostri il suo.
const ATTESA_MENU_MS = 450;

// Sorgente per il mondo della pagina. La sonda è un tasto destro finto sul punto vero: il primo ascolto del sito che ne
// legge posizione, bersaglio o tasti si ferma lì, prima di poter disegnare qualcosa; chi annulla senza guardare conta
// lo stesso. React ascolta tutto dalla radice: lì decidono le sue proprietà onContextMenu sul percorso.
function sorgenteSonda(tipo) {
  return `(function(){
  'use strict';
  var TIPO = ${JSON.stringify(tipo)};
  var O = Object, W = window, ET = EventTarget.prototype, EP = Event.prototype;
  var aggiungi = ET.addEventListener, manda = ET.dispatchEvent;
  var ferma = EP.stopImmediatePropagation, annulla = EP.preventDefault, percorso = EP.composedPath;
  var chiDescr = O.getOwnPropertyDescriptor(EP, 'currentTarget');
  var chi = chiDescr && chiDescr.get;
  var annullatoDescr = O.getOwnPropertyDescriptor(EP, 'defaultPrevented');
  var annullato = annullatoDescr && annullatoDescr.get;
  var Evento = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  var NEUTRE = { constructor: 1, type: 1, isTrusted: 1, defaultPrevented: 1, returnValue: 1, cancelable: 1, bubbles: 1,
    composed: 1, eventPhase: 1, timeStamp: 1, currentTarget: 1, preventDefault: 1, stopPropagation: 1,
    stopImmediatePropagation: 1, cancelBubble: 1 };
  var FERMO = {};
  var voci = [], viste = {};
  for (var p = Evento.prototype; p && p !== O.prototype; p = O.getPrototypeOf(p)) {
    var nomi = O.getOwnPropertyNames(p);
    for (var i = 0; i < nomi.length; i++) {
      var n = nomi[i];
      if (NEUTRE[n] === 1 || viste[n] === 1 || /^[A-Z_]+$/.test(n)) continue;
      viste[n] = 1;
      voci.push([n, O.getOwnPropertyDescriptor(p, n)]);
    }
  }
  function chiavi(n) { try { return O.keys(n); } catch (e) { return []; } }
  function radiceReact(n) {
    var k = chiavi(n);
    for (var i = 0; i < k.length; i++) if (k[i].indexOf('__reactContainer$') === 0 || k[i] === '_reactRootContainer') return true;
    return false;
  }
  function reactAscolta(t) {
    for (var n = t, giri = 0; n && giri < 1000; giri++) {
      var k = chiavi(n);
      for (var i = 0; i < k.length; i++) {
        if (k[i].indexOf('__reactProps$') !== 0 && k[i].indexOf('__reactEventHandlers$') !== 0) continue;
        var pr = n[k[i]];
        if (pr && (typeof pr.onContextMenu === 'function' || typeof pr.onContextMenuCapture === 'function')) return true;
      }
      n = n.parentNode || (n.nodeType === 11 && n.host) || null;
    }
    return false;
  }
  function sonda(t, q) {
    if (reactAscolta(t)) return true;
    var ev, visto = false;
    try {
      ev = new Evento('contextmenu', { bubbles: true, cancelable: true, composed: true, view: W,
        clientX: q.clientX, clientY: q.clientY, screenX: q.screenX, screenY: q.screenY,
        ctrlKey: q.ctrlKey, altKey: q.altKey, shiftKey: q.shiftKey, metaKey: q.metaKey,
        button: 2, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true });
    } catch (e) { return false; }
    var messe = [];
    voci.forEach(function (v) {
      var nome = v[0], d = v[1];
      try {
        O.defineProperty(ev, nome, { configurable: true, enumerable: true, get: function () {
          var c = chi ? chi.call(ev) : null;
          if (c && radiceReact(c)) return d.get ? d.get.call(ev) : d.value;
          visto = true;
          ferma.call(ev);
          throw FERMO;
        } });
        messe.push(nome);
      } catch (e) {}
    });
    try { manda.call(t, ev); } catch (e) {}
    for (var i = 0; i < messe.length; i++) { try { delete ev[messe[i]]; } catch (e) {} }
    return visto || !!(annullato && annullato.call(ev));
  }
  // L'ascolto fermato dalla sonda non è un errore del sito: né la console né chi raccoglie i suoi errori lo vedono.
  aggiungi.call(W, 'error', function (e) { if (e.error === FERMO) { ferma.call(e); annulla.call(e); } }, true);
  aggiungi.call(W, 'unhandledrejection', function (e) { if (e.reason === FERMO) { ferma.call(e); annulla.call(e); } }, true);
  aggiungi.call(W, TIPO, function (q) {
    ferma.call(q);
    var t = null;
    try { t = percorso.call(q)[0] || q.target; } catch (e) { t = null; }
    if (t && sonda(t, q)) annulla.call(q);
  }, true);
})();`;
}

function casuale() {
  try {
    const b = new Uint8Array(12);
    globalThis.crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }
}

// Copia inerte del tasto destro: dopo la consegna l'evento perde composedPath() (torna vuoto), quindi l'elemento
// reale, anche dentro uno shadow DOM, e i dati che l'handler legge si fotografano subito.
function fotografa(e) {
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

// La parte del mondo isolato: la sonda, il passaggio al sito del prossimo tasto destro e `primo` (il sito dove l'utente
// ha dato il tasto destro al menu del sito, che il content script tiene allineato alle impostazioni).
// `apriFilo(copia)`: riapre il menu di Filo dove il sito non ha mostrato niente.
function monta(webFrame, finestra = globalThis, { apriFilo = () => {} } = {}) {
  let tipo = '';
  const inietta = () => {
    tipo = `filo-menu-${casuale()}`;
    try { webFrame.executeJavaScript(sorgenteSonda(tipo), false).catch(() => {}); } catch (_) {}
  };
  inietta();
  let passaFino = 0;
  // I punti dove il sito ha annullato il menu senza mostrarne uno: lì la voce non torna, finché la pagina resta.
  const soloBlocco = new WeakSet();
  const segnato = (n) => {
    for (let x = n, i = 0; x && i < 1000; i++) {
      if (soloBlocco.has(x)) return true;
      x = x.parentNode || (x.nodeType === 11 && x.host) || null;
    }
    return false;
  };
  const diFilo = (n) => {
    const el = n && n.nodeType === 3 ? n.parentNode : n;
    try { return !!globalThis.SN_FILO_UI?.inside?.(el); } catch (_) { return false; }
  };
  const delSito = (m) => (m.type === 'childList'
    ? [...m.addedNodes, ...m.removedNodes].some((x) => !diFilo(x))
    : !diFilo(m.target));

  return {
    primo: false,
    fotografa,
    // Una pagina che si riscrive perde gli ascolti del suo mondo: la sonda si rimette con un nome nuovo.
    rinasci: inietta,
    sonda(e, bersaglio) {
      if (!bersaglio || typeof bersaglio.dispatchEvent !== 'function' || !tipo || segnato(bersaglio)) return false;
      let q;
      try {
        q = new finestra.MouseEvent(tipo, {
          cancelable: true,
          clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
          ctrlKey: !!e.ctrlKey, altKey: !!e.altKey, shiftKey: !!e.shiftKey, metaKey: !!e.metaKey,
        });
      } catch (_) { return false; }
      try { return bersaglio.dispatchEvent(q) === false; } catch (_) { return false; }
    },
    lasciaAlSito(ms = PASSAGGIO_MS) { passaFino = Date.now() + ms; },
    passaAlSito() {
      if (!passaFino || Date.now() > passaFino) { passaFino = 0; return false; }
      passaFino = 0;
      return true;
    },
    // Dopo il tasto destro passato al sito. Chi lo annulla senza mostrare niente blocca e basta: lì l'utente ritrova il
    // menu di Filo, senza la voce. `ancheSeTace`: chi passa un tasto destro finto (un riquadro) riapre Filo anche
    // quando il sito non lo annulla, perché lì il browser non mostra il suo.
    seguiPassaggio(copia, annullato, { ancheSeTace = false } = {}) {
      let cambiato = false;
      let mo = null;
      try {
        mo = new MutationObserver((lista) => { if (!cambiato && lista.some(delSito)) cambiato = true; });
        mo.observe(finestra.document, { subtree: true, childList: true, attributes: true, characterData: true });
      } catch (_) { mo = null; }
      const fine = () => { if (mo) { try { mo.disconnect(); } catch (_) {} } };
      setTimeout(() => {
        if (!annullato()) {
          fine();
          if (ancheSeTace) apriFilo(copia);
          return;
        }
        setTimeout(() => {
          fine();
          if (cambiato || !mo) return;
          if (copia && copia.target) soloBlocco.add(copia.target);
          apriFilo(copia);
        }, ATTESA_MENU_MS);
      }, 0);
    },
  };
}

module.exports = { monta, sorgenteSonda, fotografa, PASSAGGIO_MS, ATTESA_MENU_MS };
