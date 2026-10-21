// I riquadri che stanno caricando il loro indirizzo. Toccarne uno prima del suo load (contentWindow, contentDocument, uno
// script nel suo mondo isolato) gli toglie il preload, e dentro Filo sparisce (#1560): chi tocca un riquadro passa da qui.
// Regole: patterns/riquadri-incorporati-iframe-filo-gira-anche-li.md; sentinella tests/unit/riquadriInArrivo.test.mjs.

(function (global) {
  'use strict';
  // Rieseguito coi content script dopo il document_start: il conto dei load è già partito e non si azzera.
  if (global.SN_RIQUADRI_IN_ARRIVO) return;

  const eRiquadro = (n) => !!n && (n.localName === 'iframe' || n.localName === 'frame');

  // L'indirizzo che il riquadro carica; '' se è vuoto o about:blank, che la pagina riempie da sé e non ha un preload suo.
  function indirizzo(f) {
    if (f.hasAttribute('srcdoc')) return 'srcdoc';
    const src = String(f.getAttribute('src') || '').trim();
    return /^(about:blank)?$/i.test(src) ? '' : src;
  }

  // Il documento di cui si conoscono i load: quello del preload che ha chiamato `osserva`, dal document_start.
  let stato = null;

  function osserva(win) {
    if (stato || !win || !win.document) return;
    stato = { doc: win.document, caricatoA: new WeakMap() };
    const { caricatoA } = stato;
    win.addEventListener('load', (e) => { if (eRiquadro(e.target)) caricatoA.set(e.target, indirizzo(e.target)); }, true);
    // Rimesso nella pagina, un riquadro ricarica da capo: il load di prima non vale più.
    try {
      new win.MutationObserver((giri) => {
        for (const g of giri) {
          for (const n of g.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (eRiquadro(n)) caricatoA.delete(n);
            else if (n.firstElementChild) for (const f of n.getElementsByTagName('iframe')) caricatoA.delete(f);
          }
        }
      }).observe(win.document, { childList: true, subtree: true });
    } catch (_) {}
  }

  function inArrivo(f) {
    if (!eRiquadro(f)) return false;
    const a = indirizzo(f);
    const doc = f.ownerDocument;
    if (!a || !doc) return false;
    if (stato && doc === stato.doc) {
      // In una radice ombra il load non arriva alla finestra: da qui non si sa, e si fa come prima.
      if (f.getRootNode() !== doc) return false;
      return stato.caricatoA.get(f) !== a;
    }
    // Un riquadro di un documento più sotto: lo sa il Filo di quel documento, se ne ha uno.
    let altro = null;
    try {
      const w = doc.defaultView;
      altro = w && w !== global ? w.SN_RIQUADRI_IN_ARRIVO : null;
    } catch (_) { altro = null; }
    return !!(altro && altro !== API && typeof altro.inArrivo === 'function' && altro.inArrivo(f));
  }

  function qualcunoInArrivo() {
    if (!stato) return false;
    for (const f of stato.doc.querySelectorAll('iframe, frame')) if (inArrivo(f)) return true;
    return false;
  }

  function finestra(f) {
    if (!eRiquadro(f) || inArrivo(f)) return null;
    try { return f.contentWindow || null; } catch (_) { return null; }
  }

  function documento(f) {
    if (!eRiquadro(f) || inArrivo(f)) return null;
    try { return f.contentDocument || null; } catch (_) { return null; }
  }

  // Della stessa origine di chi lo ospita: un riquadro così, se fosse lui a scrivere, lo direbbe già `frameElement`.
  function stessaOrigine(f) {
    try {
      if (f.hasAttribute('srcdoc')) return true;
      const doc = f.ownerDocument;
      return new URL(f.getAttribute('src'), doc.baseURI).origin === doc.location.origin;
    } catch (_) { return true; }
  }

  // Il riquadro di `radice` la cui finestra è `w` (chi ha mandato un messaggio). Uno in arrivo si tocca solo all'ultimo
  // giro e solo se è di un'altra origine: quel riquadro, se ha già scritto, sta in un processo suo e lì non perde niente.
  function riquadroDi(w, radice) {
    if (!w || !radice) return null;
    try {
      const el = w.frameElement;
      if (eRiquadro(el) && radice.contains(el)) return el;
    } catch (_) {}
    let tutti = [];
    try { tutti = Array.from(radice.querySelectorAll('iframe, frame')); } catch (_) { return null; }
    for (const f of tutti) if (finestra(f) === w) return f;
    for (const f of tutti) {
      if (!inArrivo(f) || stessaOrigine(f)) continue;
      try { if (f.contentWindow === w) return f; } catch (_) {}
    }
    return null;
  }

  const API = { osserva, inArrivo, qualcunoInArrivo, finestra, documento, riquadroDi };
  global.SN_RIQUADRI_IN_ARRIVO = API;
})(typeof globalThis !== 'undefined' ? globalThis : self);
