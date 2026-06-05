// Modalità zoom con la rotella, attivata dal click centrale (rotella del mouse).
//
// PERCHÉ ESISTE
//   Il click centrale di Chromium attiva l'autoscroll nativo: compare l'ancora
//   e per scrollare devi spostare il mouse su/giù rispetto al punto cliccato.
//   Un alpha tester l'ha trovato scomodo e ha chiesto di sostituirlo con una
//   "modalità zoom": un click sulla rotella la attiva, mentre è attiva la
//   rotella zooma/dezooma la pagina (invece di scrollare); un altro click (o
//   Esc) la disattiva.
//
// SCELTE (UX, non chieste esplicitamente ma necessarie per completezza):
//   - Il click centrale su un LINK continua ad aprirlo in una nuova scheda
//     (non lo intercettiamo): repurporre il tasto centrale non deve far perdere
//     una funzione standard del browser.
//   - La modalità è un toggle (un click attiva, un altro disattiva) e Esc esce.
//   - Un piccolo badge in alto a destra segnala che la modalità è attiva.
//   - Uscendo NON si azzera lo zoom raggiunto: si torna solo a scrollare.
//
// Gira nel contesto del preload (ha accesso a `webFrame` di Electron), sia sulle
// pagine web (page-preload) sia sulle pagine interne filo:// (internal-preload).

module.exports = function setupWheelZoom(webFrame) {
  if (!webFrame || typeof document === 'undefined') return;

  const ZOOM_STEP = 0.5;   // come un passo di Ctrl +/- (in "zoom level")
  const MIN_LEVEL = -5;
  const MAX_LEVEL = 5;

  let zoomMode = false;
  let badge = null;

  function makeBadge() {
    const el = document.createElement('div');
    el.id = '__filo-zoom-badge';
    el.setAttribute('role', 'status');
    el.textContent = '🔍 Zoom attivo — rotella per zoomare, Esc per uscire';
    Object.assign(el.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
      background: 'rgba(20,20,20,0.88)', color: '#fff',
      font: '12px/1.4 system-ui, -apple-system, sans-serif',
      padding: '6px 10px', borderRadius: '8px', pointerEvents: 'none',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)', userSelect: 'none',
    });
    return el;
  }

  function enter() {
    if (zoomMode) return;
    zoomMode = true;
    try {
      if (!badge) badge = makeBadge();
      (document.body || document.documentElement).appendChild(badge);
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

  // Click centrale: attiva/disattiva la modalità zoom e blocca l'autoscroll
  // nativo (preventDefault sul mousedown del tasto centrale). Sui link, fuori
  // dalla modalità zoom, lasciamo passare il comportamento nativo (nuova scheda).
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return;
    if (!zoomMode && isOnLink(e.target)) return;
    e.preventDefault();   // niente autoscroll
    e.stopPropagation();
    toggle();
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
  }, { capture: true, passive: false });

  // Esc esce dalla modalità zoom.
  document.addEventListener('keydown', (e) => {
    if (zoomMode && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exit();
    }
  }, true);
};
