// Modalità zoom con la rotella, attivata dal click centrale (rotella del mouse).
//
// PERCHÉ ESISTE
//   Il click centrale di Chromium attiva l'autoscroll nativo: compare l'ancora
//   e per scrollare devi spostare il mouse su/giù rispetto al punto cliccato.
//   Un alpha tester l'ha trovato scomodo e ha chiesto di sostituirlo con una
//   "modalità zoom": un click sulla rotella la attiva, mentre è attiva la
//   rotella zooma/dezooma la pagina (invece di scrollare).
//
// COME SI CHIUDE (feedback alpha)
//   Una volta attiva, QUALSIASI interazione la chiude: un altro click (sinistro,
//   destro o centrale) e qualsiasi tasto della tastiera. L'unica eccezione è
//   l'interazione col badge stesso, che ospita la percentuale di zoom editabile.
//
// IL BADGE
//   In alto a destra un badge mostra "zoom 100%, rotella per zoomare". La
//   percentuale è un campo editabile: l'utente può digitare un valore e premere
//   Invio per impostare lo zoom esatto. Niente emoji, niente menzione di Esc.
//   Uscendo NON si azzera lo zoom raggiunto: si torna solo a scrollare.
//
//   LO STESSO BADGE ANCHE ZOOMANDO CON CTRL (#427.1)
//   Filo non ha barra degli indirizzi: senza il badge, chi zooma con Ctrl (+/-,
//   rotella, pinch) non ha NESSUN posto dove leggere a che percentuale è
//   arrivato né un appiglio per tornare al 100%. Lo stesso badge compare quindi
//   anche su quella strada, ma "di passaggio": sparisce da solo dopo un paio di
//   secondi (la modalità rotella invece lo tiene, perché lì è l'indicatore di
//   una modalità attiva). Di passaggio resta comunque editabile — è lo stesso
//   badge, non un avviso — e il conto alla rovescia si ferma finché il puntatore
//   ci sta sopra o si sta scrivendo dentro, altrimenti sarebbe un campo che
//   svanisce mentre lo usi. Cambia solo la coda "rotella per zoomare", che fuori
//   dalla modalità rotella sarebbe un'istruzione falsa.
//
// Gira nel contesto del preload (ha accesso a `webFrame` di Electron), sia sulle
// pagine web (page-preload) sia sulle pagine interne filo:// (internal-preload).
//
// ZOOM CON CTRL (opts.pageZoom)
//   Oltre alla modalità rotella, se `opts.pageZoom` è attivo la pagina zooma
//   anche tenendo Ctrl/Cmd: pizzicando il trackpad, con Ctrl+rotella e da
//   tastiera con Ctrl + / Ctrl - / Ctrl 0. Pinch e Ctrl+rotella arrivano
//   entrambi come `wheel` con ctrlKey=true. È attivo sia sulle pagine web
//   esterne (page-preload) sia sulle pagine interne filo:// (internal-preload):
//   lo zoom deve funzionare allo stesso modo ovunque.
//
//   OPT-OUT PER LE PAGINE CHE ZOOMANO DA SÉ
//   Una pagina che implementa il proprio zoom (l'editor scala il foglio via CSS
//   invece dell'intera finestra) si tira fuori marcando
//   `document.documentElement.dataset.filoOwnZoom = '1'`. Il controllo avviene
//   al momento dell'evento, quindi il marker può essere messo quando vuole:
//   senza, lo zoom verrebbe applicato due volte.
//
//   QUANDO IL FOCUS È SULLA BARRA DI FILO
//   Se l'utente ha appena cliccato una scheda, i tasti vanno alla barra e non
//   alla pagina: nessun keydown arriva qui. Il main (tabs.js) intercetta lì
//   Ctrl +/-/0 e li inoltra alla scheda attiva come `filo:zoom-key`, che
//   rientra da questo stesso modulo — così la regola su chi zooma resta una
//   sola. Serve `opts.ipcRenderer`.

module.exports = function setupWheelZoom(webFrame, opts) {
  if (!webFrame || typeof document === 'undefined') return;
  const pageZoom = !!(opts && opts.pageZoom);
  const ipc = (opts && opts.ipcRenderer) || null;

  const ZOOM_STEP = 0.5;   // come un passo di Ctrl +/- (in "zoom level")
  const MIN_LEVEL = -5;
  const MAX_LEVEL = 5;
  const BADGE_LINGER_MS = 2000; // quanto resta il badge dopo uno zoom con Ctrl

  let zoomMode = false;
  let badge = null;
  let percentInput = null;
  let hintEl = null;       // la coda ", rotella per zoomare" (solo in modalità rotella)
  let hideTimer = null;
  let suppressContextMenu = false;

  // Percentuale di zoom corrente (100 = nessuno zoom).
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

  // Applica la percentuale digitata nel campo come fattore di zoom esatto.
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
    input.addEventListener('blur', () => {
      applyPercentFromInput();
      // Finito di scrivere fuori dalla modalità rotella: riparte il conto alla
      // rovescia, altrimenti il badge di passaggio resterebbe lì per sempre.
      if (!zoomMode) armHide();
    });
    el.appendChild(input);
    percentInput = input;

    el.appendChild(document.createTextNode('%'));
    hintEl = document.createElement('span');
    hintEl.textContent = ', rotella per zoomare';
    el.appendChild(hintEl);
    return el;
  }

  // Attacca il badge al documento (creandolo la prima volta) e ne allinea la
  // coda: l'istruzione "rotella per zoomare" vale solo in modalità rotella.
  function mountBadge(withHint) {
    try {
      if (!badge) badge = makeBadge();
      if (!badge.isConnected) (document.body || document.documentElement).appendChild(badge);
      if (hintEl) hintEl.style.display = withHint ? '' : 'none';
      refreshPercent();
    } catch (_) {}
    return badge;
  }

  function unmountBadge() {
    try { if (badge && badge.parentNode) badge.parentNode.removeChild(badge); } catch (_) {}
  }

  // Il badge non sparisce mentre l'utente ci sta interagendo: col puntatore
  // sopra (sta andando a scriverci) o col cursore dentro il campo.
  function badgeHeld() {
    try {
      if (percentInput && document.activeElement === percentInput) return true;
      return !!(badge && badge.isConnected && badge.matches(':hover'));
    } catch (_) { return false; }
  }

  function cancelHide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }

  function armHide() {
    cancelHide();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (zoomMode) return;      // in modalità rotella il badge è permanente
      if (badgeHeld()) { armHide(); return; }
      unmountBadge();
    }, BADGE_LINGER_MS);
  }

  // Badge "di passaggio": lo zoom è cambiato con Ctrl (tasti, rotella, pinch).
  function flashBadge() {
    if (zoomMode) return;        // lì il badge c'è già, e ci resta
    mountBadge(false);
    armHide();
  }

  function enter() {
    if (zoomMode) return;
    zoomMode = true;
    cancelHide();                // se era di passaggio, ora è dell'ospite
    try {
      mountBadge(true);
      document.documentElement.style.cursor = 'zoom-in';
    } catch (_) {}
    try { document.documentElement.dataset.filoZoomMode = '1'; } catch (_) {}
  }

  function exit() {
    if (!zoomMode) return;
    zoomMode = false;
    cancelHide();
    unmountBadge();
    try { document.documentElement.style.cursor = ''; } catch (_) {}
    try { delete document.documentElement.dataset.filoZoomMode; } catch (_) {}
  }

  function toggle() { if (zoomMode) exit(); else enter(); }

  function isOnLink(target) {
    return !!(target && target.closest && target.closest('a[href], area[href]'));
  }

  // L'interazione col badge (editare la percentuale) non deve chiudere la modalità.
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

    // Punto unico da cui passa OGNI zoom con Ctrl (tasti, rotella, pinch,
    // inoltro dalla barra): qui si aggiorna la percentuale e si mostra il badge
    // di passaggio, così nessuna delle strade resta senza riscontro (#427.1).
    function setLevel(level) {
      const clamped = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
      try { webFrame.setZoomLevel(clamped); } catch (_) {}
      refreshPercent();
      flashBadge();
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
        if (pageHandlesZoom()) return;
        try {
          if (dir === 'reset') setLevel(0);
          else if (dir === 'in') setLevel(webFrame.getZoomLevel() + ZOOM_STEP);
          else if (dir === 'out') setLevel(webFrame.getZoomLevel() - ZOOM_STEP);
        } catch (_) {}
      });
    }
  }
};
