// «L'utente ha appena fatto qualcosa?»: l'unica prova che una chiamata automatica al modello parta da lui (#1070).
// Conta solo input fisici veri: `input`, `focus` e `selectionchange` sono `isTrusted` anche quando li causa uno script
// (execCommand, focus(), addRange). Regola e racconto: patterns/una-chiamata-che-spende-parte-da-un-gesto-vero.md.

(function (global) {
  'use strict';

  const FINESTRA_MS = 1500;
  // Niente mousemove: passarci sopra non è chiedere qualcosa, e una pagina ci si aggancerebbe.
  const EVENTI = Object.freeze([
    'keydown', 'keyup', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
    'touchstart', 'touchend', 'dblclick', 'paste', 'drop', 'compositionend',
  ]);

  function crea(ora = () => Date.now()) {
    let ultimo = 0;
    const presi = new Map();
    function segna() { ultimo = ora(); }
    function recente(ms = FINESTRA_MS) { return ultimo > 0 && ora() - ultimo <= ms; }
    // Un gesto paga una sola chiamata per chi lo prende: lo script che dopo un clic cambia la selezione tre volte ne ottiene una.
    function prendi(chi, ms = FINESTRA_MS) {
      if (!recente(ms) || presi.get(chi) === ultimo) return false;
      presi.set(chi, ultimo);
      return true;
    }
    function ascolta(target) {
      if (!target || typeof target.addEventListener !== 'function') return;
      for (const tipo of EVENTI) {
        target.addEventListener(tipo, (e) => { if (e && e.isTrusted === true) segna(); }, { capture: true, passive: true });
      }
    }
    return { recente, prendi, segna, ascolta };
  }

  const gesto = crea();
  if (typeof window !== 'undefined') gesto.ascolta(window);
  global.SN_GESTO = { FINESTRA_MS, EVENTI, crea, ...gesto };
})(typeof globalThis !== 'undefined' ? globalThis : self);
