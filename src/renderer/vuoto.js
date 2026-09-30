// Il vuoto di una vista sopra la pagina, lato disegno: i gesti che ci cadono tornano alla scheda (li rigira
// il main) e sopra il vuoto il puntatore è quello della pagina. Lo usano gli avvisi e la barra laterale.
// Regole: patterns/la-shell-non-disegna-sopra-la-pagina.md
(() => {
  'use strict';
  const TASTO = ['left', 'middle', 'right'];
  const BIT = [1, 4, 2];
  // I tasti premuti passano tali e quali: Ctrl e Cmd li legge la pagina, non la vista.
  const TASTI_MOD = [['shiftKey', 'shift'], ['ctrlKey', 'control'], ['altKey', 'alt'], ['metaKey', 'meta']];
  const FORME = new Set(['default', 'pointer', 'text', 'crosshair', 'wait', 'help', 'move', 'progress', 'cell',
    'copy', 'alias', 'none', 'not-allowed', 'no-drop', 'grab', 'grabbing', 'zoom-in', 'zoom-out', 'context-menu',
    'vertical-text', 'col-resize', 'row-resize', 'all-scroll', 'e-resize', 'n-resize', 'ne-resize', 'nw-resize',
    's-resize', 'se-resize', 'sw-resize', 'w-resize', 'ns-resize', 'ew-resize', 'nesw-resize', 'nwse-resize']);
  // Electron chiama 'pointer' la freccia e 'hand' la mano: in CSS la mano è 'pointer'.
  const DA_ELECTRON = { pointer: 'default', hand: 'pointer', nodrop: 'no-drop', 'drag-drop-none': 'no-drop',
    'drag-drop-move': 'move', 'drag-drop-copy': 'copy', 'drag-drop-link': 'alias' };
  function formaCss(forma) {
    const f = String(forma || '');
    if (Object.prototype.hasOwnProperty.call(DA_ELECTRON, f)) return DA_ELECTRON[f];
    if (/panning/.test(f)) return 'all-scroll';
    return FORME.has(f) ? f : '';
  }
  function modificatori(e) {
    const m = TASTI_MOD.filter(([k]) => e[k]).map(([, nome]) => nome);
    if (e.buttons & 1) m.push('leftButtonDown');
    if (e.buttons & 4) m.push('middleButtonDown');
    if (e.buttons & 2) m.push('rightButtonDown');
    return m;
  }

  // proprio(e, 'giu' | 'muovi' | 'rotella'): il gesto è della vista, non della pagina.
  // versoLaPagina(e): uscendo dalla vista di lì il puntatore entra nella pagina, che da lì riceve i gesti veri.
  function collega({ inoltra, onCursore, proprio, versoLaPagina }) {
    const root = document.documentElement;
    let gestoDellaPagina = false;
    let sopraIlVuoto = false;
    let formaPagina = '';
    const manda = (tipo, e, extra) => inoltra(Object.assign({ tipo, x: e.clientX, y: e.clientY, mod: modificatori(e) }, extra || {}));
    function lasciaIlVuoto(e, entraNellaPagina) {
      if (!sopraIlVuoto) return;
      sopraIlVuoto = false;
      root.style.cursor = '';
      if (!entraNellaPagina) manda('mouseLeave', e);
    }
    // Un gesto partito dal vuoto resta della pagina fino al rilascio (trascinare la barra di scorrimento,
    // selezionare del testo), anche se passa sopra quello che la vista disegna.
    document.addEventListener('mousedown', (e) => {
      // Nessun altro tasto premuto: è un gesto nuovo, anche se il rilascio del precedente si è perso.
      if (e.buttons === BIT[e.button]) gestoDellaPagina = false;
      if (!gestoDellaPagina && proprio(e, 'giu')) return;
      gestoDellaPagina = true;
      e.preventDefault();
      manda('mouseDown', e, { tasto: TASTO[e.button] || 'left', clic: e.detail });
    }, true);
    document.addEventListener('mouseup', (e) => {
      if (!gestoDellaPagina) return;
      if (!e.buttons) gestoDellaPagina = false;
      e.preventDefault();
      manda('mouseUp', e, { tasto: TASTO[e.button] || 'left', clic: e.detail });
    }, true);
    document.addEventListener('mousemove', (e) => {
      if (gestoDellaPagina || !proprio(e, 'muovi')) {
        if (!sopraIlVuoto) root.style.cursor = formaPagina;
        sopraIlVuoto = true;
        manda('mouseMove', e);
      } else {
        lasciaIlVuoto(e);
      }
    }, true);
    root.addEventListener('mouseleave', (e) => {
      if (gestoDellaPagina) return;
      lasciaIlVuoto(e, versoLaPagina(e));
    });
    document.addEventListener('wheel', (e) => {
      if (!gestoDellaPagina && proprio(e, 'rotella')) return;
      e.preventDefault();
      const riga = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? innerHeight : 1;
      manda('mouseWheel', e, { dx: -e.deltaX * riga, dy: -e.deltaY * riga });
    }, { capture: true, passive: false });
    // L'ultimo puntatore della pagina vale anche se è arrivato mentre si era sopra la vista: entrando nel vuoto si usa.
    if (onCursore) {
      onCursore((forma) => {
        formaPagina = formaCss(forma);
        if (sopraIlVuoto) root.style.cursor = formaPagina;
      });
    }
    return {
      gestoDellaPagina: () => gestoDellaPagina,
      sopraIlVuoto: () => sopraIlVuoto,
    };
  }

  window.SN_VUOTO = { collega };
})();
