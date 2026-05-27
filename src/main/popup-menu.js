// Popup menu custom: BrowserWindow frameless + trasparente che mostra un menu
// stilizzato come il menu tasto destro. Risolve il problema per cui i dropdown
// HTML nella shell non possono apparire sopra una WebContentsView nativa.

const { BrowserWindow, nativeTheme } = require('electron');
const path = require('node:path');

let activePopup = null;

// ── SVG icon paths (viewBox 0 0 24 24, stroke-based) ──────────────────────
const ICON_PATHS = {
  editor:
    '<path d="M5 4h7l5 5v11h-12z"/><path d="M12 4v5h5"/>' +
    '<path d="M8 13h3"/>' +
    '<path d="M19.5 14.5l-6 6L11 21l.5-2.5 6-6a1.4 1.4 0 0 1 2 2z"/>',

  feedback:
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',

  options:
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/>',

  colorPicker:
    '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',

  lock:
    '<rect x="5" y="11" width="14" height="9" rx="1.5"/>' +
    '<path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
};

function iconSvg(name, size) {
  const inner = ICON_PATHS[name];
  if (!inner) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// ── Mostra il menu ────────────────────────────────────────────────────────
function showPopupMenu(parentWin, entries, x, y, onSelect) {
  // Chiudi un eventuale popup precedente
  if (activePopup && !activePopup.isDestroyed()) {
    activePopup.close();
    activePopup = null;
  }

  const isDark = nativeTheme.shouldUseDarkColors;

  // Misure
  const ITEM_H = 36;
  const SEP_H = 9;
  const PAD = 8;
  const WIDTH = 200;
  const SHADOW = 16; // margine extra per l'ombra CSS
  let contentH = PAD * 2;
  for (const e of entries) contentH += e.type === 'separator' ? SEP_H : ITEM_H;

  // Posizione in coordinate schermo
  const cb = parentWin.getContentBounds();
  let popX = cb.x + x - SHADOW / 2;
  let popY = cb.y + y - 2;
  // Non uscire dal bordo destro
  if (popX + WIDTH + SHADOW > cb.x + cb.width) {
    popX = cb.x + cb.width - WIDTH - SHADOW;
  }

  const popup = new BrowserWindow({
    parent: parentWin,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    hasShadow: false,
    width: WIDTH + SHADOW,
    height: contentH + SHADOW,
    x: Math.round(popX),
    y: Math.round(popY),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload', 'popup-preload.js'),
    },
  });

  activePopup = popup;

  const html = buildHTML(entries, isDark);
  popup.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  popup.once('ready-to-show', () => popup.show());

  popup.on('blur', () => {
    if (!popup.isDestroyed()) popup.close();
  });
  popup.on('closed', () => {
    if (activePopup === popup) activePopup = null;
  });

  // Ricezione della scelta (scoped al webContents del popup)
  popup.webContents.on('ipc-message', (_event, channel, url) => {
    if (channel === 'popup-menu:select') {
      onSelect(url);
      if (!popup.isDestroyed()) popup.close();
    }
  });
}

// ── Genera l'HTML inline ──────────────────────────────────────────────────
function buildHTML(entries, isDark) {
  const c = isDark
    ? { bg: 'rgba(30,29,27,0.98)', fg: '#e5e3dc', muted: '#8a8780',
        border: '#3a3835', ar: '196,90,59' }
    : { bg: 'rgba(248,246,240,0.98)', fg: '#1a1918', muted: '#6e6b63',
        border: '#e0dcd4', ar: '196,90,59' };

  let items = '';
  for (const e of entries) {
    if (e.type === 'separator') {
      items += '<div class="sep"></div>';
    } else {
      const ico = iconSvg(e.icon, 16);
      // Escape HTML nel label per sicurezza
      const label = (e.label || '').replace(/[<>&"]/g, (ch) =>
        ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]);
      const url = (e.url || '').replace(/'/g, "\\'");
      items += `<button class="item" onclick="popupApi.select('${url}')">` +
        `<span class="ico">${ico}</span>` +
        `<span class="lbl">${label}</span></button>`;
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;overflow:hidden;height:100%}
.menu{
  margin:${16 / 2}px;
  background:${c.bg};
  border:1px solid ${c.border};
  border-radius:8px;
  box-shadow:0 6px 24px rgba(0,0,0,0.22);
  padding:4px 0;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  font-size:13px;
  color:${c.fg};
  backdrop-filter:blur(8px);
  animation:fadeIn 100ms ease-out;
}
@keyframes fadeIn{
  from{opacity:0;transform:translateY(-3px)}
  to{opacity:1;transform:translateY(0)}
}
.item{
  all:unset;box-sizing:border-box;
  display:flex;align-items:center;gap:10px;
  width:100%;padding:8px 14px;
  cursor:pointer;color:${c.fg};
  font-family:inherit;font-size:13px;line-height:1.2;
}
.item:hover{background:rgba(${c.ar},0.12)}
.ico{
  width:18px;height:18px;flex:0 0 18px;
  display:inline-flex;align-items:center;justify-content:center;
  color:rgba(${c.ar},0.85);
}
.lbl{flex:1}
.sep{height:1px;background:${c.border};margin:4px 8px}
</style></head><body><div class="menu">${items}</div></body></html>`;
}

module.exports = { showPopupMenu };
