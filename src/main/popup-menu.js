// Popup menu custom: BrowserWindow frameless + trasparente che mostra un menu
// stilizzato come il menu tasto destro. Risolve il problema per cui i dropdown
// HTML nella shell non possono apparire sopra una WebContentsView nativa.

const { BrowserWindow, nativeTheme } = require('electron');
const path = require('node:path');
const { hideForTests } = require('./test-window-mode');

let activePopup = null;

// ── SVG icon paths (viewBox 0 0 24 24, stroke-based) ──────────────────────
const ICON_PATHS = {
  // Editor = foglio con l'angolo piegato e due righe di testo: è la stessa
  // icona degli appunti (`note` in src/shared/icons.js). Da quando gli appunti
  // vivono dentro l'editor e non hanno più un pannello a parte, l'editor È il
  // posto degli appunti: le due icone devono coincidere ovunque. Questo
  // registro è una COPIA (il popup è una BrowserWindow a parte e non carica
  // shared/icons.js): se cambi l'una, cambia anche l'altra.
  editor:
    '<path d="M6 3.5h8l4 4v13H6z"/>' +
    '<path d="M14 3.5v4h4"/>' +
    '<path d="M9 12.5h6"/>' +
    '<path d="M9 15.8h4"/>',

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

  // Libro aperto — voce "Trasparenza". COPIA di `transparency` in
  // src/shared/icons.js: se cambi l'una cambia anche l'altra, o le due
  // superfici disegnano icone diverse per la stessa voce.
  transparency:
    '<path d="M12 6.6C10.4 5.1 8.3 4.6 4 4.6v12.6c4.3 0 6.4.5 8 2 1.6-1.5 3.7-2 8-2V4.6c-4.3 0-6.4.5-8 2z"/>' +
    '<path d="M12 6.6v14.6"/>',

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

  // Globo con meridiani — voce "Apri da un altro paese" / "Torna in Italia"
  // (mai un lucchetto da security tool: il tono è "viaggio", non "sicurezza").
  globe:
    '<circle cx="12" cy="12" r="9"/>' +
    '<path d="M3 12h18"/>' +
    '<path d="M12 3a13.5 13.5 0 0 1 0 18"/>' +
    '<path d="M12 3a13.5 13.5 0 0 0 0 18"/>',

  // Mazzi (deck builder Commander): due carte a ventaglio, quella davanti
  // dritta e quella dietro ruotata. Stesso disegno di src/shared/icons.js
  // (le due famiglie di icone — barra e menu popup — vanno tenute allineate).
  decks:
    '<rect x="8" y="5" width="10" height="14" rx="1.5"/>' +
    '<path d="M6.5 7.2l-2.9.8 3.1 11 3.4-.9"/>',

  // Bacheca: una lavagna a colonne (kanban) — i miglioramenti affissi che si
  // votano. Distinta dall'aeroplanino di "condividi", che qui era fuori tema.
  board:
    '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/>' +
    '<path d="M9 5v14"/>' +
    '<path d="M15 5v14"/>',

  // Scaricamenti: freccia verso il basso che entra in un vassoio. Stesso
  // disegno di src/shared/icons.js (`download`): la voce "Scaricamenti" del
  // menu App restava senza icona perché qui mancava il glifo.
  download:
    '<path d="M12 3v11"/>' +
    '<path d="M8 10.5l4 4 4-4"/>' +
    '<path d="M4 19h16"/>',

  // Salva/Aperti per dopo: segnalibro. Stesso disegno di src/shared/icons.js
  // (`saveForLater`), così la lista "Aperti per dopo" nel menu App porta la
  // stessa icona con cui la si riempie dal menu del tasto destro.
  saveForLater:
    '<path d="M7 4h10a1 1 0 0 1 1 1v15.2l-6-3.8-6 3.8V5a1 1 0 0 1 1-1z"/>',
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
    // La freccia del submenu (subAction) occupa una colonna extra a destra.
    const SUB_COL = e.subAction ? 30 : 0;
    const w = H_PADDING + (hasIcon ? ICON_COL : 0) + SUB_COL + Math.ceil(label.length * charW);
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

  // Nei test la finestra madre è invisibile: il menu è una finestra a sé e
  // altrimenti comparirebbe da solo sullo schermo (vedi test-window-mode.js).
  hideForTests(popup);
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
        const main = `<button class="item" onclick="popupApi.select('${escVal}')">` +
          `${icoSpan}` +
          `<span class="lbl">${label}</span></button>`;
        if (e.subAction) {
          // Voce a due zone di click: il corpo esegue `action`, la freccia a
          // destra manda `subAction` (il chiamante riapre il menu col secondo
          // livello — es. la lista paesi di "Apri da un altro paese").
          const escSub = ('@action:' + e.subAction).replace(/'/g, "\\'");
          items += `<div class="row">${main}` +
            `<button class="subarrow" aria-label="Altre opzioni" ` +
            `onclick="popupApi.select('${escSub}')">` +
            `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" ` +
            `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
            `stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></div>`;
        } else {
          items += main;
        }
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
.row{display:flex;align-items:stretch}
.row .item{flex:1;min-width:0}
.subarrow{
  all:unset;box-sizing:border-box;
  display:inline-flex;align-items:center;justify-content:center;
  flex:0 0 30px;cursor:pointer;color:${c.muted};
}
.subarrow:hover{background:rgba(${c.ar},0.12);color:rgba(${c.ar},0.95)}
</style></head><body><div class="menu">${items}</div></body></html>`;
}

module.exports = { showPopupMenu, buildHTML, computeMenuWidth };
