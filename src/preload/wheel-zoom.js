// La porta UNICA dello zoom della pagina: modalità rotella (click centrale, al
// posto dell'autoscroll nativo) e, con `opts.pageZoom`, Ctrl/Cmd + rotella,
// pinch e tasti. Gira nel preload, uguale su pagine web e pagine filo://.
//
// Chi passa di qui rispetta l'opt-out `dataset.filoOwnZoom = '1'`, con cui una
// pagina che scala da sé (l'editor) evita il doppio zoom. Per questo anche i
// tasti presi dalla barra di Filo rientrano da qui invece di agire per conto
// loro: la regola su chi zooma deve restare una sola.

module.exports = function setupWheelZoom(webFrame, opts) {
  if (!webFrame || typeof document === 'undefined') return;
  const pageZoom = !!(opts && opts.pageZoom);
  const ipc = (opts && opts.ipcRenderer) || null;

  const ZOOM_STEP = 0.5;   // come un passo di Ctrl +/- (in "zoom level")
  const MIN_LEVEL = -5;
  const MAX_LEVEL = 5;

  let zoomMode = false;
  let badge = null;
  let percentInput = null;
  let suppressContextMenu = false;

  function currentPercent() {
    try { return Math.round(webFrame.getZoomFactor() * 100); }
    catch (_) { return 100; }
  }

  function refreshPercent() {
    // Non sovrascrivere mentre l'utente sta digitando nel campo.
    if (percentInput && document.activeElement !== percentInput) {
      percentInput.value = String(currentPercent());
    }
  }

  function applyPercentFromInput() {
    if (!percentInput) return;
    const v = parseInt(String(percentInput.value).replace(/[^\d]/g, ''), 10);
    if (Number.isFinite(v) && v > 0) {
      const factor = Math.max(0.25, Math.min(5, v / 100));
      try { webFrame.setZoomFactor(factor); } catch (_) {}
    }
    if (percentInput) percentInput.value = String(currentPercent());
  }

  function makeBadge() {
    const el = document.createElement('div');
    el.id = '__filo-zoom-badge';
    el.setAttribute('role', 'status');
    Object.assign(el.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
      background: 'rgba(20,20,20,0.88)', color: '#fff',
      font: '12px/1.4 system-ui, -apple-system, sans-serif',
      padding: '6px 10px', borderRadius: '8px', pointerEvents: 'auto',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)', userSelect: 'none',
      display: 'flex', alignItems: 'center', gap: '0',
    });
    el.appendChild(document.createTextNode('zoom '));

    const input = document.createElement('input');
    input.id = '__filo-zoom-percent';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', 'Percentuale zoom');
    Object.assign(input.style, {
      width: '3.4em', textAlign: 'right', background: 'transparent',
      color: '#fff', border: 'none',
      borderBottom: '1px dashed rgba(255,255,255,0.55)',
      font: 'inherit', padding: '0 1px', margin: '0', outline: 'none',
    });
    input.addEventListener('keydown', (e) => {
      // Mentre si edita la percentuale, i tasti NON chiudono la modalità.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        applyPercentFromInput();
        input.blur();
      }
    });
    input.addEventListener('blur', () => { applyPercentFromInput(); });
    el.appendChild(input);
    percentInput = input;

    el.appendChild(document.createTextNode('%, rotella per zoomare'));
    return el;
  }

  function enter() {
    if (zoomMode) return;
    zoomMode = true;
    try {
      if (!badge) badge = makeBadge();
      (document.body || document.documentElement).appendChild(badge);
      refreshPercent();
      document.documentElement.style.cursor = 'zoom-in';
    } catch (_) {}
    try { document.documentElement.dataset.filoZoomMode = '1'; } catch (_) {}
  }

  function exit() {
    if (!zoomMode) return;
    zoomMode = false;
    try { if (badge && badge.parentNode) badge.parentNode.removeChild(badge); } catch (_) {}
    try { document.documentElement.style.cursor = ''; } catch (_) {}
    try { delete document.documentElement.dataset.filoZoomMode; } catch (_) {}
  }

  function toggle() { if (zoomMode) exit(); else enter(); }

  function isOnLink(target) {
    return !!(target && target.closest && target.closest('a[href], area[href]'));
  }

  // L'unica interazione che NON chiude la modalità: si sta editando la %.
  function isInBadge(target) {
    return !!(badge && target && (target === badge || (badge.contains && badge.contains(target))));
  }

  // Click: il centrale attiva/disattiva la modalità (e blocca l'autoscroll
  // nativo). In modalità zoom, QUALSIASI click (sinistro o destro) fuori dal
  // badge la chiude. Sui link, fuori dalla modalità, il click centrale resta
  // nativo (apre in nuova scheda).
  document.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      if (!zoomMode && isOnLink(e.target)) return;
      e.preventDefault();   // niente autoscroll
      e.stopPropagation();
      toggle();
      return;
    }
    if (zoomMode && !isInBadge(e.target)) {
      if (e.button === 2) suppressContextMenu = true; // niente menu sul destro
      e.preventDefault();
      e.stopPropagation();
      exit();
    }
  }, true);

  // Sopprimi il menu contestuale solo quando il click destro è servito a chiudere
  // la modalità zoom (così il destro "chiude e basta", senza aprire il menu).
  document.addEventListener('contextmenu', (e) => {
    if (suppressContextMenu) {
      suppressContextMenu = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // La rotella, in modalità zoom, zooma invece di scrollare.
  document.addEventListener('wheel', (e) => {
    if (!zoomMode) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.deltaY < 0 ? 1 : -1; // rotella su = zoom in
    let next = webFrame.getZoomLevel() + dir * ZOOM_STEP;
    next = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, next));
    webFrame.setZoomLevel(next);
    refreshPercent();
  }, { capture: true, passive: false });

  // Qualsiasi tasto chiude la modalità — tranne mentre si edita la percentuale
  // nel badge (gestito dal listener sull'input, che ferma la propagazione).
  document.addEventListener('keydown', (e) => {
    if (!zoomMode) return;
    if (isInBadge(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    exit();
  }, true);

  // ── Zoom della pagina con Ctrl/Cmd (solo se opts.pageZoom) ──────────────
  // Indipendente dalla modalità rotella: basta tenere Ctrl (o pizzicare il
  // trackpad). Usa il livello di zoom del webFrame, così scala l'intera pagina
  // (testo + immagini) come il classico zoom del browser.
  if (pageZoom) {
    // La pagina zooma da sé (vedi commento in testa): non ci mettiamo in mezzo.
    function pageHandlesZoom() {
      try { return document.documentElement.dataset.filoOwnZoom === '1'; }
      catch (_) { return false; }
    }

    function setLevel(level) {
      const clamped = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
      try { webFrame.setZoomLevel(clamped); } catch (_) {}
      refreshPercent();
    }

    // Pinch del trackpad e Ctrl+rotella → wheel con ctrlKey=true. Passo
    // proporzionale al delta così il pinch (incrementi piccoli) resta fluido.
    // In modalità rotella ci pensa già l'handler sopra: qui ci tiriamo fuori.
    document.addEventListener('wheel', (e) => {
      if (zoomMode) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (pageHandlesZoom()) return;
      e.preventDefault();
      e.stopPropagation();
      // ~0.005/unità: un notch di rotella (deltaY≈100) ≈ un passo di Ctrl +/-
      // (ZOOM_STEP=0.5); il pinch del trackpad (delta piccoli) resta fluido.
      let next;
      try { next = webFrame.getZoomLevel() - e.deltaY * 0.005; }
      catch (_) { return; }
      setLevel(next);
    }, { capture: true, passive: false });

    // Da tastiera: Ctrl + / Ctrl - / Ctrl 0. Accettiamo anche il tastierino
    // numerico via `code` (lì `key` è già '+'/'-'/'0', ma non su tutti i layout).
    document.addEventListener('keydown', (e) => {
      if (zoomMode) return; // in modalità rotella un tasto qualsiasi esce
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (pageHandlesZoom()) return;
      const k = e.key;
      const c = e.code;
      const isIn = k === '+' || k === '=' || c === 'NumpadAdd';
      const isOut = k === '-' || k === '_' || c === 'NumpadSubtract';
      const isReset = k === '0' || c === 'Numpad0';
      if (isIn) {
        e.preventDefault(); e.stopPropagation();
        try { setLevel(webFrame.getZoomLevel() + ZOOM_STEP); } catch (_) {}
      } else if (isOut) {
        e.preventDefault(); e.stopPropagation();
        try { setLevel(webFrame.getZoomLevel() - ZOOM_STEP); } catch (_) {}
      } else if (isReset) {
        e.preventDefault(); e.stopPropagation();
        setLevel(0); // 100%
      }
    }, true);

    // Stesse scorciatoie, ma premute mentre il focus è sulla barra di Filo
    // (fila delle schede): lì i tasti non arrivano alla pagina, quindi il main
    // li inoltra qui. Passano dallo STESSO punto degli altri, così l'opt-out
    // delle pagine che zoomano da sé vale anche per questa strada.
    if (ipc && typeof ipc.on === 'function') {
      ipc.on('filo:zoom-key', (_e, dir) => {
        // La pagina che zooma da sé (l'editor scala il foglio) non deve essere
        // zoomata da qui — ma il tasto va comunque CONSEGNATO, altrimenti su
        // Mac il suo zoom muore in silenzio: là questa è l'unica strada, perché
        // il tasto se lo prende la barra dei menu prima che arrivi alla pagina.
        // Su Windows e Linux il keydown della pagina arriva e basta a sé.
        //
        // Il verso sta nel NOME dell'evento, non in `detail`: fra il mondo
        // isolato del preload e quello della pagina un `detail` non passa.
        if (pageHandlesZoom()) {
          try {
            const nomi = { in: 'filo:zoom-in', out: 'filo:zoom-out', reset: 'filo:zoom-reset' };
            if (nomi[dir]) document.dispatchEvent(new Event(nomi[dir]));
          } catch (_) {}
          return;
        }
        try {
          if (dir === 'reset') setLevel(0);
          else if (dir === 'in') setLevel(webFrame.getZoomLevel() + ZOOM_STEP);
          else if (dir === 'out') setLevel(webFrame.getZoomLevel() - ZOOM_STEP);
        } catch (_) {}
      });
    }
  }
};
