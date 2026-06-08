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

  close:
    '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',

  duplicate:
    '<rect x="9" y="9" width="11" height="11" rx="2"/>' +
    '<path d="M5 15V5a2 2 0 0 1 2-2h10"/>',

  // Altoparlante con onde sonore (audio attivo) — voce "Muta".
  sound:
    '<path d="M4 9v6h4l5 4V5L8 9z"/>' +
    '<path d="M16.5 8.5a5 5 0 0 1 0 7"/>' +
    '<path d="M19 6a8 8 0 0 1 0 12"/>',

  // Altoparlante barrato (audio mutato) — voce "Riattiva audio".
  mute:
    '<path d="M4 9v6h4l5 4V5L8 9z"/>' +
    '<path d="M17 9l4 6"/><path d="M21 9l-4 6"/>',

  // Punto interrogativo in un fumetto — voce "Aiuto" (apre la chat con Filo).
  help:
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
    '<path d="M9.2 9.3a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.4-2.6 2.4"/>' +
    '<path d="M12 15.2h.01"/>',

  user:
    '<circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/>',

  incognito:
    '<path d="M3 13h18"/>' +
    '<path d="M6 13l1.4-3.8A2.2 2.2 0 0 1 9.5 7.8h5a2.2 2.2 0 0 1 2.1 1.4L18 13"/>' +
    '<circle cx="8" cy="16.2" r="2.3"/>' +
    '<circle cx="16" cy="16.2" r="2.3"/>' +
    '<path d="M10.3 16.2h3.4"/>',

  models:
    '<circle cx="12" cy="5" r="2"/>' +
    '<circle cx="5.5" cy="18" r="2"/>' +
    '<circle cx="18.5" cy="18" r="2"/>' +
    '<path d="M11 6.7L6.5 16.3"/>' +
    '<path d="M13 6.7L17.5 16.3"/>' +
    '<path d="M7.5 18L16.5 18"/>',
};

function iconSvg(name, size) {
  const inner = ICON_PATHS[name];
  if (!inner) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// Larghezza del menu adattata al contenuto. Con una larghezza fissa (200px) le
// voci lunghe — tipicamente l'email dell'account loggato — venivano troncate/
// ellissate e sembravano "non centrate" e schiacciate contro il bordo (feedback
// alpha). Stimiamo la larghezza del testo più lungo e allarghiamo il menu fino a
// un massimo ragionevole, mantenendo un minimo così i menu corti restano uguali.
const MENU_MIN_W = 200;
const MENU_MAX_W = 340;
function computeMenuWidth(entries) {
  const H_PADDING = 28;   // padding orizzontale dell'item (14px * 2)
  const ICON_COL = 28;    // icona (18px) + gap (10px) quando presente
  let needed = MENU_MIN_W;
  for (const e of entries || []) {
    if (e.type === 'separator') continue;
    const label = String(e.label || '');
    // L'email (voce disabled senza icona) usa font 12px, le altre 13px. Stima
    // generosa (~0.6 * font-size per carattere) per non troncare mai.
    const fontPx = e.disabled ? 12 : 13;
    const charW = fontPx * 0.6;
    const hasIcon = !!e.icon && ICON_PATHS[e.icon];
    const w = H_PADDING + (hasIcon ? ICON_COL : 0) + Math.ceil(label.length * charW);
    if (w > needed) needed = w;
  }
  return Math.min(MENU_MAX_W, needed);
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
  const WIDTH = computeMenuWidth(entries);
  // Gutter trasparente attorno al menu, dimensionato per contenere INTERAMENTE
  // l'ombra CSS (box-shadow:0 4px 20px → si estende ~24px in basso, ~20px ai
  // lati, ~16px in alto). Con un gutter troppo stretto l'ombra veniva tagliata
  // dal bordo della finestra e finiva "di colpo" (feedback alpha).
  const MARGIN = 26;
  let contentH = PAD * 2;
  for (const e of entries) contentH += e.type === 'separator' ? SEP_H : ITEM_H;

  const WIN_W = WIDTH + MARGIN * 2;
  const WIN_H = contentH + MARGIN * 2;

  // Posizione in coordinate schermo. Il menu visibile (dentro il gutter) deve
  // restare ancorato vicino al pulsante: il suo bordo sinistro a `x`, il bordo
  // superiore ~6px sotto `y`.
  const cb = parentWin.getContentBounds();
  let popX = cb.x + x - MARGIN;
  let popY = cb.y + y + 6 - MARGIN;
  // Non uscire dal bordo destro
  if (popX + WIN_W > cb.x + cb.width) {
    popX = cb.x + cb.width - WIN_W;
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
    width: WIN_W,
    height: WIN_H,
    x: Math.round(popX),
    y: Math.round(popY),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload', 'popup-preload.js'),
    },
  });

  activePopup = popup;

  const html = buildHTML(entries, isDark, MARGIN);
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
function buildHTML(entries, isDark, margin = 26) {
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
      // Mostra la colonna icona solo se l'icona esiste davvero: una colonna
      // vuota spingeva il testo a destra e faceva sembrare le voci senza icona
      // (es. l'email dell'account) "non centrate" (feedback alpha).
      const icoSpan = ico ? `<span class="ico">${ico}</span>` : '';
      // Escape HTML nel label per sicurezza
      const label = (e.label || '').replace(/[<>&"]/g, (ch) =>
        ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]);
      if (e.disabled) {
        // Voce informativa non cliccabile (es. l'email dell'account loggato).
        // Senza icona la centriamo nel suo campo per evitare l'indent fantasma.
        const cls = ico ? 'item disabled' : 'item disabled centered';
        items += `<div class="${cls}">` +
          `${icoSpan}` +
          `<span class="lbl">${label}</span></div>`;
      } else {
        // Le voci possono trasportare un `url` (apre un tab) oppure una
        // `action` custom (instradata al renderer chiamante). Codifichiamo
        // l'action con un prefisso sentinella per non confonderla con un url.
        const value = e.action ? ('@action:' + e.action) : (e.url || '');
        const escVal = value.replace(/'/g, "\\'");
        items += `<button class="item" onclick="popupApi.select('${escVal}')">` +
          `${icoSpan}` +
          `<span class="lbl">${label}</span></button>`;
      }
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;overflow:hidden;height:100%}
.menu{
  margin:${margin}px;
  background:${c.bg};
  border:1px solid ${c.border};
  border-radius:8px;
  box-shadow:0 4px 20px rgba(0,0,0,0.20);
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
.item.disabled{color:${c.muted};cursor:default;font-size:12px}
.item.disabled:hover{background:transparent}
.item.centered{justify-content:center;text-align:center}
.ico{
  width:18px;height:18px;flex:0 0 18px;
  display:inline-flex;align-items:center;justify-content:center;
  color:rgba(${c.ar},0.85);
}
.lbl{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item.centered .lbl{flex:0 1 auto}
.sep{height:1px;background:${c.border};margin:4px 8px}
</style></head><body><div class="menu">${items}</div></body></html>`;
}

module.exports = { showPopupMenu, buildHTML, computeMenuWidth };
