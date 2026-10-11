// «L'utente ha appena fatto qualcosa, cosa e dove?»: l'unica prova che una chiamata automatica al modello parta da lui (#1070).
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
  const PRESSIONI = new Set(['mousedown', 'pointerdown', 'touchstart']);
  const RILASCI = new Set(['mouseup', 'pointerup', 'touchend']);
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

  // Dove ha toccato un gesto: l'elemento vero (anche dentro un componente) e, per mouse e dito, il punto.
  function luogoDi(e) {
    let el = null;
    try { const via = typeof e.composedPath === 'function' ? e.composedPath() : null; el = (via && via[0]) || e.target || null; } catch (_) { el = e.target || null; }
    if (el && el.nodeType === 3) el = el.parentElement;
    const dito = e.changedTouches && e.changedTouches[0];
    const da = dito || e;
    const punto = typeof da.clientX === 'number' && typeof da.clientY === 'number';
    return { el, x: punto ? da.clientX : null, y: punto ? da.clientY : null, tasto: typeof e.key === 'string' ? e.key : '' };
  }

  // «Il gesto è caduto dentro questo elemento»: la casella del correttore si paga solo scrivendoci.
  function dentro(el) {
    return (l) => Boolean(l && l.el && el && (l.el === el || (typeof el.contains === 'function' && el.contains(l.el))));
  }

  const MARGINE_RIGA = 24;
  function campoAttivo() {
    let a = typeof document !== 'undefined' ? document.activeElement : null;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  function selezioneDi(el) {
    let n = el;
    for (let i = 0; n && i < 20; i++) {
      const root = typeof n.getRootNode === 'function' ? n.getRootNode() : null;
      if (!root || root.nodeType !== 11) break;
      if (typeof root.getSelection === 'function') { const s = root.getSelection(); if (s && s.rangeCount && !s.isCollapsed) return s; }
      n = root.host;
    }
    return typeof window !== 'undefined' ? window.getSelection() : null;
  }
  // «Il gesto ha fatto o toccato la selezione»: il mouse e il dito sulle sue righe (il rilascio di un trascinamento
  // cade spesso nel margine, accanto alla riga), la tastiera nel blocco o nel campo dove sta la selezione.
  function sullaSelezione(l) {
    if (!l || !l.el) return false;
    const campo = campoAttivo();
    if (campo && (campo.tagName === 'TEXTAREA' || campo.tagName === 'INPUT')) {
      let pieno = false;
      try { pieno = campo.selectionStart !== campo.selectionEnd; } catch (_) {}
      if (pieno) return dentro(campo)(l);
    }
    const sel = selezioneDi(l.el);
    if (!sel || !sel.rangeCount) return false;
    const r = sel.getRangeAt(0);
    if (l.x !== null && l.y !== null) {
      for (const q of r.getClientRects()) if (l.y >= q.top - MARGINE_RIGA && l.y <= q.bottom + MARGINE_RIGA) return true;
      return false;
    }
    const c = r.commonAncestorContainer;
    return Boolean(c && typeof l.el.contains === 'function' && l.el.contains(c));
  }

  function crea(ora = () => Date.now()) {
    let ultimo = 0;
    let corrente = null; // il gesto in corso: una pressione, anche tenuta, è un gesto solo
    let pressione = null; // l'ultima pressione di mouse o dito: il rilascio tocca anche dove è cominciata
    let contatore = 0;
    const ultimoDi = new Map(); // tipo → l'ultimo gesto che lo chiede
    const premuti = new Map(); // tasto → il gesto della sua pressione
    const presi = new Map();
    function segna(tipi = TUTTI, luogo = null) {
      const g = { id: ++contatore, t: ora(), tipi: new Set(tipi), luoghi: luogo ? [luogo] : [] };
      ultimo = g.t;
      corrente = g;
      for (const tipo of g.tipi) ultimoDi.set(tipo, g);
      return g;
    }
    // Ripetizioni e rilascio di un tasto tengono vivo il gesto della sua pressione, non ne aprono uno nuovo:
    // tenere premuta una freccia non deve valere trenta gesti per secondo.
    function tieni(g, luogo) {
      g.t = ultimo = ora();
      if (luogo && luogo.el && !g.luoghi.some((l) => l.el === luogo.el)) g.luoghi.push(luogo);
    }
    function gestoDi(tipo) { return tipo ? ultimoDi.get(tipo) || null : corrente; }
    function recente(tipo, ms = FINESTRA_MS) {
      const g = gestoDi(tipo);
      const t = tipo ? (g ? g.t : 0) : ultimo;
      return Boolean(g) && t > 0 && ora() - t <= ms;
    }
    // Un gesto paga una sola chiamata per chi lo prende: lo script che dopo un clic cambia la selezione tre volte ne
    // ottiene una. Col tipo, solo un gesto che chiede quella chiamata: scrivere una lettera non paga una spiegazione.
    // Con `tocca`, solo un gesto caduto sulla cosa per cui si spende: scrivere nella ricerca non paga un'altra casella.
    function prendi(chi, tipo, tocca) {
      const g = gestoDi(tipo);
      if (!recente(tipo) || presi.get(chi) === g.id) return false;
      if (typeof tocca === 'function' && !g.luoghi.some((l) => { try { return tocca(l); } catch (_) { return false; } })) return false;
      presi.set(chi, g.id);
      return true;
    }
    function suEvento(e) {
      if (!e || e.isTrusted !== true) return;
      const luogo = luogoDi(e);
      if (e.type === 'keydown' || e.type === 'keyup') {
        const tasto = e.code || e.key || '';
        const premuto = premuti.get(tasto);
        if (e.type === 'keydown') {
          if (e.repeat && premuto) tieni(premuto);
          else premuti.set(tasto, segna(tipiDelTasto(e), luogo));
        } else {
          if (premuto) tieni(premuto, luogo); else segna(tipiDelTasto(e), luogo);
          premuti.delete(tasto);
        }
        return;
      }
      const g = segna(TIPI_EVENTO[e.type] || [], luogo);
      if (PRESSIONI.has(e.type)) pressione = g;
      else if (RILASCI.has(e.type) && pressione) for (const l of pressione.luoghi) if (!g.luoghi.includes(l)) g.luoghi.push(l);
    }
    function ascolta(target) {
      if (!target || typeof target.addEventListener !== 'function') return;
      for (const tipo of EVENTI) target.addEventListener(tipo, suEvento, { capture: true, passive: true });
    }
    return { recente, prendi, segna, ascolta, suEvento };
  }

  const gesto = crea();
  if (typeof window !== 'undefined') gesto.ascolta(window);
  global.SN_GESTO = { FINESTRA_MS, EVENTI, SELEZIONA, CHIUDE, tipiDelTasto, luogoDi, dentro, sullaSelezione, crea, ...gesto };
})(typeof globalThis !== 'undefined' ? globalThis : self);
