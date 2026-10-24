// Geometria degli overlay posati sopra la pagina (menu del tasto destro, riquadro di Filo).
// CRESCONO dopo essere stati posati, e misurarli solo all'apertura taglia la roba in coda.
// Qui solo numeri, senza DOM.

(function (global) {
  'use strict';

  // Margine minimo fra l'overlay e i bordi della finestra.
  const GAP = 8;

  // `null` = ci sta tutto: nessun tetto, nessuna barra di scorrimento. `scale` è la
  // compensazione zoom: l'overlay occupa `h * scale`, quindi il tetto si riporta dividendo.
  function computeCap({ h, vh, scale, gap = GAP, min = 96 }) {
    const s = (Number.isFinite(scale) && scale > 0) ? scale : 1;
    if (h * s + 2 * gap <= vh) return null;
    return Math.max(min, vh - 2 * gap) / s;
  }

  // `visW`/`visH`: quanto occupa DAVVERO sullo schermo. `from` è la posa attuale, passata solo
  // se l'overlay è già a schermo: lì non si ribalta sotto il cursore, si scivola in su.
  function computeOffset({ x, y, visW, visH, vw, vh, from, gap = GAP, bias = 0 }) {
    let left = from ? from.left : x;
    let top = from ? from.top : y + bias;
    if (left + visW + gap > vw) left = vw - visW - gap;
    // Prima posa: se sotto il punto d'ancoraggio non ci sta, si apre in alto.
    if (!from && top + visH + gap > vh) top = Math.max(gap, y - visH - bias);
    // Ricrescita (e ultima rete della prima posa): scivola in su quanto basta.
    if (top + visH + gap > vh) top = vh - visH - gap;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    return { left, top };
  }

  function readScale(el) {
    const m = /scale\(\s*([0-9.]+)\s*\)/.exec((el && el.style && el.style.transform) || '');
    const v = m ? parseFloat(m[1]) : 1;
    return (Number.isFinite(v) && v > 0) ? v : 1;
  }

  // Si toglie il tetto, si misura l'altezza naturale e si rimette solo se serve ancora:
  // quello del giro prima falserebbe la misura. Tutto sincrono, quindi niente sfarfallio.
  function applyCap(root, opts) {
    const o = opts || {};
    const gap = o.gap == null ? GAP : o.gap;
    const min = o.min == null ? 96 : o.min;
    root.style.maxHeight = '';
    root.style.overflowY = '';
    root.style.overscrollBehavior = '';
    const scale = readScale(root);
    const vh = window.innerHeight;
    let cap = computeCap({ h: root.offsetHeight, vh, scale, gap, min });
    if (o.limit != null && root.offsetHeight > o.limit) {
      cap = cap == null ? o.limit : Math.min(cap, o.limit);
    }
    if (cap != null) {
      root.style.maxHeight = `${cap}px`;
      root.style.overflowY = 'auto';
      // Lo scorrimento si ferma DENTRO l'overlay: in fondo alla spiegazione la rotella passerebbe
      // alla pagina, e uno scroll di pagina chiude il menu — col trackpad quasi sempre.
      root.style.overscrollBehavior = 'contain';
      // `max-height` morde il box scelto dal CSS: con `content-box` bordo e imbottitura restano
      // FUORI dal conto e l'overlay sfora comunque. La differenza si misura e si toglie.
      const extra = root.offsetHeight - cap;
      if (extra > 0) root.style.maxHeight = `${Math.max(48, cap - extra)}px`;
    }
    return { scale, cap };
  }

  // Tetto per un overlay che NON si può spostare perché l'utente l'ha messo lì: cresce fino
  // al bordo, poi scorre. Sotto il minimo scivolare è il male minore: ci pensa computeOffset.
  function computePinnedLimit({ top, vh, scale, gap = GAP, min = 96 }) {
    const s = (Number.isFinite(scale) && scale > 0) ? scale : 1;
    return Math.max(min, (vh - top - gap) / s);
  }

  // Il confronto è con la misura dell'ULTIMA posa: senza, l'overlay si riposerebbe
  // all'infinito rispondendo al proprio stesso tetto. Ritorna la funzione per staccarsi.
  function observeGrowth(root, riposa) {
    if (typeof ResizeObserver !== 'function') return () => {};
    const misura = () => `${root.offsetWidth}x${root.offsetHeight}`;
    let posato = misura();
    const ro = new ResizeObserver(() => {
      if (misura() === posato) return;
      riposa();
      posato = misura();
    });
    ro.observe(root);
    return () => { try { ro.disconnect(); } catch (_) {} };
  }

  global.SN_PLACE = {
    GAP, computeCap, computeOffset, computePinnedLimit, readScale, applyCap, observeGrowth,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
