// «L'utente ha appena fatto qualcosa, e cosa?»: l'unica prova che una chiamata automatica al modello parta da lui (#1070).
// Conta solo input fisici veri: `input`, `focus` e `selectionchange` sono `isTrusted` anche quando li causa uno script
// (execCommand, focus(), addRange). Regola e racconto: patterns/una-chiamata-che-spende-parte-da-un-gesto-vero.md.

(function (global) {
  'use strict';

  const FINESTRA_MS = 1500;
  // Cosa un gesto può chiedere: una chiamata dice il tipo che la paga, e un tasto qualunque non compra tutto.
  const SELEZIONA = 'seleziona';
  const CHIUDE = 'chiude'; // chiude una parola: il controllo della parola appena scritta
  const TUTTI = Object.freeze([SELEZIONA, CHIUDE]);
  // Niente mousemove: passarci sopra non è chiedere qualcosa, e una pagina ci si aggancerebbe.
  const TIPI_EVENTO = Object.freeze({
    mousedown: [SELEZIONA], mouseup: [SELEZIONA], pointerdown: [SELEZIONA], pointerup: [SELEZIONA],
    touchstart: [SELEZIONA], touchend: [SELEZIONA], dblclick: [SELEZIONA],
    paste: [CHIUDE], drop: [CHIUDE], compositionend: [CHIUDE],
  });
  const EVENTI = Object.freeze(['keydown', 'keyup', ...Object.keys(TIPI_EVENTO)]);
  const SPOSTA = /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/;

  // Seleziona solo Maiusc con un tasto di spostamento o «seleziona tutto»; chiude una parola uno spazio, una
  // punteggiatura, Invio. Le tastiere che non dicono il tasto (virtuali, IME) possono aver chiuso una parola.
  function tipiDelTasto(e) {
    const k = typeof e.key === 'string' ? e.key : '';
    const mod = Boolean(e.ctrlKey || e.metaKey);
    const tipi = [];
    if ((e.shiftKey && SPOSTA.test(k)) || (mod && (e.code === 'KeyA' || k.toLowerCase() === 'a'))) tipi.push(SELEZIONA);
    const separatore = [...k].length === 1 && !/[\p{L}\p{N}\p{M}]/u.test(k);
    if (!mod && (separatore || k === 'Enter' || k === 'Unidentified' || k === 'Process')) tipi.push(CHIUDE);
    return tipi;
  }

  function crea(ora = () => Date.now()) {
    let ultimo = 0;
    let corrente = null; // il gesto in corso: una pressione, anche tenuta, è un gesto solo
    let contatore = 0;
    const ultimoDi = new Map(); // tipo → l'ultimo gesto che lo chiede
    const premuti = new Map(); // tasto → il gesto della sua pressione
    const presi = new Map();
    function segna(tipi = TUTTI) {
      const g = { id: ++contatore, t: ora(), tipi: new Set(tipi) };
      ultimo = g.t;
      corrente = g;
      for (const tipo of g.tipi) ultimoDi.set(tipo, g);
      return g;
    }
    // Ripetizioni e rilascio di un tasto tengono vivo il gesto della sua pressione, non ne aprono uno nuovo:
    // tenere premuta una freccia non deve valere trenta gesti per secondo.
    function tieni(g) { g.t = ultimo = ora(); }
    function gestoDi(tipo) { return tipo ? ultimoDi.get(tipo) || null : corrente; }
    function recente(tipo, ms = FINESTRA_MS) {
      const g = gestoDi(tipo);
      const t = tipo ? (g ? g.t : 0) : ultimo;
      return Boolean(g) && t > 0 && ora() - t <= ms;
    }
    // Un gesto paga una sola chiamata per chi lo prende: lo script che dopo un clic cambia la selezione tre volte ne
    // ottiene una. Col tipo, solo un gesto che chiede quella chiamata: scrivere una lettera non paga una spiegazione.
    function prendi(chi, tipo) {
      const g = gestoDi(tipo);
      if (!recente(tipo) || presi.get(chi) === g.id) return false;
      presi.set(chi, g.id);
      return true;
    }
    function suEvento(e) {
      if (!e || e.isTrusted !== true) return;
      if (e.type === 'keydown' || e.type === 'keyup') {
        const tasto = e.code || e.key || '';
        const premuto = premuti.get(tasto);
        if (e.type === 'keydown') {
          if (e.repeat && premuto) tieni(premuto);
          else premuti.set(tasto, segna(tipiDelTasto(e)));
        } else {
          if (premuto) tieni(premuto); else segna(tipiDelTasto(e));
          premuti.delete(tasto);
        }
        return;
      }
      segna(TIPI_EVENTO[e.type] || []);
    }
    function ascolta(target) {
      if (!target || typeof target.addEventListener !== 'function') return;
      for (const tipo of EVENTI) target.addEventListener(tipo, suEvento, { capture: true, passive: true });
    }
    return { recente, prendi, segna, ascolta, suEvento };
  }

  const gesto = crea();
  if (typeof window !== 'undefined') gesto.ascolta(window);
  global.SN_GESTO = { FINESTRA_MS, EVENTI, SELEZIONA, CHIUDE, tipiDelTasto, crea, ...gesto };
})(typeof globalThis !== 'undefined' ? globalThis : self);
