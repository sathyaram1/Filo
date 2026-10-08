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
    let corrente = 0; // il gesto in corso: una pressione, anche tenuta, è un gesto solo
    let contatore = 0;
    const premuti = new Map(); // tasto → la sua pressione
    const presi = new Map();
    function segna() { ultimo = ora(); corrente = ++contatore; }
    // Ripetizioni e rilascio di un tasto tengono vivo il gesto della sua pressione, non ne aprono uno nuovo:
    // tenere premuta una freccia non deve valere trenta gesti per secondo.
    function tieni(tasto) {
      ultimo = ora();
      corrente = premuti.has(tasto) ? premuti.get(tasto) : ++contatore;
    }
    function recente(ms = FINESTRA_MS) { return ultimo > 0 && ora() - ultimo <= ms; }
    // Un gesto paga una sola chiamata per chi lo prende: lo script che dopo un clic cambia la selezione tre volte ne ottiene una.
    function prendi(chi, ms = FINESTRA_MS) {
      if (!recente(ms) || presi.get(chi) === corrente) return false;
      presi.set(chi, corrente);
      return true;
    }
    function suEvento(e) {
      if (!e || e.isTrusted !== true) return;
      const tasto = e.code || e.key || '';
      if (e.type === 'keydown' && !e.repeat) { segna(); premuti.set(tasto, corrente); }
      else if (e.type === 'keydown') tieni(tasto);
      else if (e.type === 'keyup') { tieni(tasto); premuti.delete(tasto); }
      else segna();
    }
    function ascolta(target) {
      if (!target || typeof target.addEventListener !== 'function') return;
      for (const tipo of EVENTI) target.addEventListener(tipo, suEvento, { capture: true, passive: true });
    }
    return { recente, prendi, segna, ascolta, suEvento };
  }

  const gesto = crea();
  if (typeof window !== 'undefined') gesto.ascolta(window);
  global.SN_GESTO = { FINESTRA_MS, EVENTI, crea, ...gesto };
})(typeof globalThis !== 'undefined' ? globalThis : self);
