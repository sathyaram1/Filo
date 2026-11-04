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
      // Da nascosta risponde come da visibile: il primo fumetto non aspetta un processo in secondo piano (#871.4).
      backgroundThrottling: false,
    },
  });
  // Il fumetto compare sotto il puntatore: se prendesse lui il mouse, la barra non saprebbe che il
  // puntatore l'ha lasciata (resterebbero aperti il fumetto e le larghezze ferme dopo una chiusura, #428).
  tipWin.setIgnoreMouseEvents(true);
  tipReady = false;
  // Un indirizzo che non condivide l'inizio con nessun'altra finestra: da data: era preso per il menu, da filo://shell/
  // per la finestra principale (#1722). La regola per le prove: tests/unit/proveRiconosconoFinestre.test.mjs.
  tipWin.loadURL('filo://src/renderer/fumetto.html');
  tipWin.webContents.once('did-finish-load', () => {
    tipReady = true;
    if (pendingShow) {
      const { madre, text, x, y } = pendingShow;
      pendingShow = null;
      if (madre && !madre.isDestroyed()) doShow(madre, text, x, y);
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
      pendingShow = { madre: parentWin, text, x, y };
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

// La finestra madre è pronta: il fumetto nasce adesso, così il primo passaggio dopo l'avvio non aspetta un processo
// nuovo e compare come i successivi (#871.4, la regola del menu: #1090).
function preparaSuggerimento(parentWin) {
  if (parentWin && !parentWin.isDestroyed()) ensureWin(parentWin);
}

module.exports = { showTooltip, hideTooltip, preparaSuggerimento };
