// I riquadri della stessa origine che non hanno ancora il loro documento. Toccarne uno da fuori (contentWindow,
// contentDocument, uno script nel suo mondo isolato) gli toglie il preload, e dentro Filo sparisce (#1560).
// Chi tocca un riquadro passa da qui. Regole: patterns/riquadri-incorporati-iframe-filo-gira-anche-li.md.

(function (global) {
  'use strict';
  // Rieseguito coi content script dopo il document_start: il conto è già partito e non si azzera.
  if (global.SN_RIQUADRI_IN_ARRIVO) return;

  const eRiquadro = (n) => !!n && (n.localName === 'iframe' || n.localName === 'frame');

  function origineDi(doc) {
    try { const o = new URL(doc.URL).origin; if (o !== 'null') return o; } catch (_) {}
    try { return new URL(doc.baseURI).origin; } catch (_) { return ''; }
  }

  // L'indirizzo a rischio, o ''. Solo uno della stessa origine eredita la finestra del documento vuoto iniziale, e con
  // lei il mondo di Filo creato dal tocco: d'altra origine il riquadro riparte da capo e il preload gira lo stesso.
  // Vuoto, about: e srcdoc la pagina li riempie da sé, e un preload loro non c'è.
  function indirizzo(f) {
    const src = String(f.getAttribute('src') || '').trim();
    if (!src || f.hasAttribute('srcdoc') || /^about:/i.test(src)) return '';
    try {
      const doc = f.ownerDocument;
      const u = new URL(src, doc.baseURI);
      return u.origin === origineDi(doc) ? u.href : '';
    } catch (_) { return ''; }
  }

  // Il documento di cui si conoscono gli arrivi: quello del preload che ha chiamato `osserva`, dal document_start.
  let stato = null;

  // Un riquadro è arrivato quando il suo preload è partito (lo dice lui) o al suo load.
  function arrivato(f) {
    if (stato && eRiquadro(f)) stato.arrivatoA.set(f, indirizzo(f));
  }

  function osserva(win) {
    if (stato || !win || !win.document) return;
    stato = { doc: win.document, arrivatoA: new WeakMap() };
    win.addEventListener('load', (e) => arrivato(e.target), true);
    // Rimesso nella pagina, un riquadro ricarica da capo: l'arrivo di prima non vale più.
    try {
      new win.MutationObserver((giri) => {
        for (const g of giri) {
          for (const n of g.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (eRiquadro(n)) stato.arrivatoA.delete(n);
            else if (n.firstElementChild) for (const f of n.getElementsByTagName('iframe')) stato.arrivatoA.delete(f);
          }
        }
      }).observe(win.document, { childList: true, subtree: true });
    } catch (_) {}
    // Questo documento è arrivato: chi lo ospita, se è della stessa origine, da adesso lo può toccare.
    try {
      const el = win.frameElement;
      const su = el && win.parent && win.parent.SN_RIQUADRI_IN_ARRIVO;
      if (su && su !== API && typeof su.arrivato === 'function') su.arrivato(el);
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
      return stato.arrivatoA.get(f) !== a;
    }
    // Un riquadro di un documento più sotto: lo sa il Filo di quel documento, se ne ha uno.
    let altro = null;
    try {
      const w = doc.defaultView;
      altro = w && w !== global ? w.SN_RIQUADRI_IN_ARRIVO : null;
    } catch (_) { altro = null; }
    return !!(altro && altro !== API && typeof altro.inArrivo === 'function' && altro.inArrivo(f));
  }

  // Anche più sotto: chi tocca alla cieca (uno script in ogni frame figlio) raggiunge pure i riquadri dei riquadri.
  function qualcunoInArrivo() {
    if (!stato) return false;
    for (const f of stato.doc.querySelectorAll('iframe, frame')) {
      if (inArrivo(f)) return true;
      try {
        const sotto = finestra(f)?.SN_RIQUADRI_IN_ARRIVO;
        if (sotto && sotto !== API && sotto.qualcunoInArrivo()) return true;
      } catch (_) {}
    }
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

  // Il riquadro di `radice` la cui finestra è `w`, cioè chi ha mandato un messaggio. Uno in arrivo non ha ancora
  // scritto niente, quindi si salta senza perdere nessuno; della stessa origine lo dice già `frameElement`.
  function riquadroDi(w, radice) {
    if (!w || !radice) return null;
    try {
      const el = w.frameElement;
      if (eRiquadro(el) && radice.contains(el)) return el;
    } catch (_) {}
    let tutti = [];
    try { tutti = radice.querySelectorAll('iframe, frame'); } catch (_) { return null; }
    for (const f of tutti) if (finestra(f) === w) return f;
    return null;
  }

  const API = { osserva, arrivato, inArrivo, qualcunoInArrivo, finestra, documento, riquadroDi };
  global.SN_RIQUADRI_IN_ARRIVO = API;
})(typeof globalThis !== 'undefined' ? globalThis : self);
