// Tooltip custom su BrowserWindow secondaria. La shell è alta 88px e non può
// far apparire il tooltip oltre il suo viewport (sotto ci sono le WebContentsView
// delle tab che coprono qualunque elemento DOM). Per i nav-btn / tab / win-btn
// usiamo una mini-window trasparente sempre sopra, come per il popup-menu, così
// l'hover mostra un riquadro Filo invece del title nativo bianco squadrato.
//
// La window è creata una sola volta on-demand e riusata: showTooltip() la
// riposiziona e ricarica il testo, hideTooltip() la nasconde con hide() (non
// close, per evitare il costo di reload ad ogni hover).

const { BrowserWindow, nativeTheme } = require('electron');

let tipWin = null;
let tipReady = false;
let pendingShow = null;

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
  // API minimale: il main process chiama webContents.send('set', {text, dark})
  const tip = document.getElementById('tip');
  const { ipcRenderer } = require('electron');
  ipcRenderer.on('set', (_e, { text, dark }) => {
    document.documentElement.classList.toggle('dark', !!dark);
    tip.textContent = text || '';
    // Misura sincrona: requestAnimationFrame non scatta quando la BrowserWindow
    // e' hidden (Electron sospende il rAF), e dopo il primo hide il tooltip
    // restava bloccato. getBoundingClientRect forza un layout reflow sincrono
    // anche con window nascosta, quindi le misure sono affidabili.
    const r = tip.getBoundingClientRect();
    ipcRenderer.send('size', { w: Math.ceil(r.width), h: Math.ceil(r.height) });
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
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });
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
  tipWin.webContents.on('ipc-message', (_e, channel, payload) => {
    if (channel === 'size' && tipWin && !tipWin.isDestroyed()) {
      const w = Math.max(20, payload.w + 4);
      const h = Math.max(16, payload.h + 4);
      tipWin.setBounds({ x: tipWin.getBounds().x, y: tipWin.getBounds().y, width: w, height: h });
      if (!tipWin.isVisible()) tipWin.showInactive();
    }
  });
  return tipWin;
}

function doShow(parentWin, text, x, y) {
  if (!tipWin || tipWin.isDestroyed()) return;
  const cb = parentWin.getContentBounds();
  // Posizione provvisoria: la window verrà ridimensionata dopo che il renderer
  // riporta la dimensione del testo (handler 'size' più sopra).
  const px = cb.x + Math.round(x);
  const py = cb.y + Math.round(y);
  tipWin.setBounds({ x: px, y: py, width: 200, height: 30 });
  tipWin.webContents.send('set', { text, dark: nativeTheme.shouldUseDarkColors });
}

function showTooltip(parentWin, text, x, y) {
  ensureWin(parentWin);
  if (!tipReady) {
    pendingShow = { text, x, y };
    return;
  }
  doShow(parentWin, text, x, y);
}

function hideTooltip() {
  if (tipWin && !tipWin.isDestroyed() && tipWin.isVisible()) tipWin.hide();
  pendingShow = null;
}

module.exports = { showTooltip, hideTooltip };
