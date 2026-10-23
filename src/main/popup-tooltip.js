// Tooltip su BrowserWindow trasparente: la shell è alta 88px e le
// WebContentsView delle tab coprono qualunque tooltip DOM che sborda.
// La window si crea una volta e si riusa (hide, non close: il reload a ogni hover si vede).

const { BrowserWindow, nativeTheme } = require('electron');
const path = require('node:path');
const { hideForTests } = require('./test-window-mode');
const { quandoSparita } = require('./popup-anteprima');

let tipWin = null;
let tipReady = false;
let pendingShow = null;
let giro = 0;

function buildHTML() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;overflow:hidden;height:100%;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
#tip{
  display:inline-block;
  padding:4px 8px;
  border-radius:6px;
  font-size:12px;
  line-height:1.2;
  white-space:nowrap;
  border:1px solid var(--border);
  background:var(--bg);
  color:var(--fg);
  box-shadow:0 4px 16px rgba(0,0,0,0.18);
}
:root{--bg:#fdf6ec;--fg:#2a221a;--border:#e2d3b5}
:root.dark{--bg:#1d1a16;--fg:#f1e7d6;--border:#3b332a}
</style></head><body><div id="tip"></div>
<script>
  // Il main manda {text, dark, giro} (tooltip-preload.js); la misura torna col suo giro.
  const tip = document.getElementById('tip');
  window.fumetto.onTesto(({ text, dark, giro }) => {
    document.documentElement.classList.toggle('dark', !!dark);
    tip.textContent = text || '';
    // Misura sincrona: requestAnimationFrame non scatta quando la BrowserWindow
    // e' hidden (Electron sospende il rAF), e dopo il primo hide il tooltip
    // restava bloccato. getBoundingClientRect forza un layout reflow sincrono
    // anche con window nascosta, quindi le misure sono affidabili.
    const r = tip.getBoundingClientRect();
    window.fumetto.misura({ w: Math.ceil(r.width), h: Math.ceil(r.height), giro });
  });
</script></body></html>`;
}

function ensureWin(parentWin) {
  if (tipWin && !tipWin.isDestroyed()) return tipWin;
  tipWin = new BrowserWindow({
    parent: parentWin,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    hasShadow: false,
    width: 200,
    height: 30,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'tooltip-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Il fumetto compare sotto il puntatore: se prendesse lui il mouse, la barra non saprebbe che il
  // puntatore l'ha lasciata (resterebbero aperti il fumetto e le larghezze ferme dopo una chiusura, #428).
  tipWin.setIgnoreMouseEvents(true);
  tipReady = false;
  tipWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildHTML()));
  tipWin.webContents.once('did-finish-load', () => {
    tipReady = true;
    if (pendingShow) {
      const { text, x, y } = pendingShow;
      pendingShow = null;
      doShow(parentWin, text, x, y);
    }
  });
  // Col processo morto il fumetto non comparirebbe più: si butta, e il prossimo ne fa uno nuovo.
  const questa = tipWin;
  questa.webContents.on('render-process-gone', () => {
    if (tipWin === questa) { tipWin = null; tipReady = false; }
    if (!questa.isDestroyed()) questa.destroy();
  });
  tipWin.webContents.on('ipc-message', (_e, channel, payload) => {
    if (channel === 'size' && tipWin && !tipWin.isDestroyed()) {
      // Nascosto mentre misurava (il puntatore se n'è andato in quell'istante): hideTooltip non l'ha trovato
      // visibile, e mostrarlo adesso lo lascerebbe appeso senza nessuno che lo tolga più.
      if (!payload || payload.giro !== giro) return;
      const w = Math.max(20, payload.w + 4);
      const h = Math.max(16, payload.h + 4);
      tipWin.setBounds({ x: tipWin.getBounds().x, y: tipWin.getBounds().y, width: w, height: h });
      // Nei test resta invisibile: è una finestra a sé (vedi test-window-mode.js).
      hideForTests(tipWin);
      if (!tipWin.isVisible()) tipWin.showInactive();
    }
  });
  return tipWin;
}

function doShow(parentWin, text, x, y) {
  if (!tipWin || tipWin.isDestroyed()) return;
  const cb = parentWin.getContentBounds();
  // Dimensione provvisoria: la corregge l'handler 'size' quando il renderer misura il testo.
  const px = cb.x + Math.round(x);
  const py = cb.y + Math.round(y);
  tipWin.setBounds({ x: px, y: py, width: 200, height: 30 });
  tipWin.webContents.send('set', { text, dark: nativeTheme.shouldUseDarkColors, giro });
}

function showTooltip(parentWin, text, x, y) {
  const mio = ++giro;
  quandoSparita(parentWin, () => {
    // Nascosto o sostituito mentre aspettava la carta: non compare più.
    if (mio !== giro || !parentWin || parentWin.isDestroyed()) return;
    ensureWin(parentWin);
    if (!tipReady) {
      pendingShow = { text, x, y };
      return;
    }
    doShow(parentWin, text, x, y);
  });
}

function hideTooltip() {
  giro++;
  if (tipWin && !tipWin.isDestroyed() && tipWin.isVisible()) tipWin.hide();
  pendingShow = null;
}

module.exports = { showTooltip, hideTooltip };
