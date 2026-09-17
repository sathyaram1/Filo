// Finestra principale e finestra incognito: la BrowserWindow che ospita la
// shell (barra in alto) e una WebContentsView per ogni scheda.

const { BrowserWindow, session } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { TabManager } = require('./tabs');
const { registerFiloProtocolForSession } = require('./protocol');

const SHELL_HEIGHT = 88;

// Finestre invisibili nei test: il perché sta in `test-window-mode.js`.
const { HIDDEN, posizioneFuoriSchermo, hideForTests } = require('./test-window-mode');

// Serve al primo disegno: in certe configurazioni la WebContentsView resta un quadrato
// vuoto finché non riceve attenzione. Nei test si mostra invisibile e senza fuoco.
function revealWindow(win) {
  try {
    if (HIDDEN) {
      win.showInactive();
      return;
    }
    win.show();
    win.moveTop();
    win.focus();
  } catch (_) {}
}

function wireWindowCommon(win, tabs) {
  // Le impostazioni di sicurezza vanno applicate PRIMA del primo tab: policy
  // WebRTC e blocco dei popup devono valere già sul newtab.
  try {
    const Storage = globalThis.SN_STORAGE;
    if (Storage && typeof Storage.getSettings === 'function') {
      Storage.getSettings().then((s) => {
        try { tabs.setSecurity(s?.security || {}); } catch (_) {}
      }).catch(() => {});
    }
  } catch (_) {}

  win.on('resize', () => tabs.layout());
  // A tutto schermo per una strada che non è quella di Filo si adotta comunque la modalità,
  // o resta uno schermo intero che Filo non sa di avere e l'Esc non ha niente da spegnere.
  win.on('enter-full-screen', () => {
    if (!tabs.contentFullscreen) tabs.setContentFullscreen(true);
    else tabs.layout();
  });
  win.on('leave-full-screen', () => {
    if (tabs.contentFullscreen) tabs.setContentFullscreen(false);
    else tabs.layout();
  });

  // #514 — a tutto schermo la barra è nascosta ma può tenere il fuoco, e da lì l'Esc non passa
  // dal before-input-event di nessuna scheda. La regola sta in tabs.js, qui non si decide.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape') return;
    if (tabs.handleFullscreenEscape(null)) event.preventDefault();
  });
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 500,
    // Diverso dal cream della shell: se la WebContentsView non rende si vede.
    backgroundColor: '#222222',
    title: 'Filo',
    icon: path.join(__dirname, '..', '..', 'assets', 'icons', 'icon-128.png'),
    ...(HIDDEN ? { ...posizioneFuoriSchermo(), show: false, skipTaskbar: true } : {}),
    // Niente title bar nativa: i pulsanti della finestra stanno nella shell.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'shell-preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });

  // Invisibile dalla nascita: fra questa e il primo disegno passano centinaia
  // di millisecondi in cui la finestra esiste già.
  hideForTests(win, { main: true });

  win.loadURL('filo://shell/shell.html');

  const tabs = new TabManager(win, null, { shellHeight: SHELL_HEIGHT });
  win._filoTabs = tabs;

  wireWindowCommon(win, tabs);

  win.webContents.once('did-finish-load', async () => {
    let restored = false;
    try { restored = await tabs.restoreSession(); } catch (_) { restored = false; }
    if (!restored) tabs.openTab('filo://newtab/');
    revealWindow(win);
  });

  return win;
}

// Incognito: niente deve sopravvivere alla chiusura. Sessione web effimera più storage
// filo:// sull'overlay in RAM; `_filoIncognito` fa avvolgere i messaggi in runIncognito().
function createIncognitoWindow() {
  // SENZA prefisso 'persist:': è quello che la rende una sessione in memoria.
  const partition = 'filo-incognito-' + randomUUID();
  const ses = session.fromPartition(partition);
  registerFiloProtocolForSession(ses);

  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 500,
    backgroundColor: '#1f1b2e',
    title: 'Filo — Incognito',
    icon: path.join(__dirname, '..', '..', 'assets', 'icons', 'icon-128.png'),
    ...(HIDDEN ? { ...posizioneFuoriSchermo(), show: false, skipTaskbar: true } : {}),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'shell-preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });
  win._filoIncognito = true;
  hideForTests(win, { main: true });

  win.loadURL('filo://shell/shell.html?incognito=1');

  const tabs = new TabManager(win, null, { shellHeight: SHELL_HEIGHT, incognito: true, partition });
  win._filoTabs = tabs;

  wireWindowCommon(win, tabs);

  win.webContents.once('did-finish-load', async () => {
    tabs.openTab('filo://newtab/'); // niente restore in incognito
    revealWindow(win);
  });

  // Solo alla chiusura dell'ULTIMA incognito: le altre stanno ancora leggendo
  // lo stesso overlay in RAM.
  win.on('closed', () => {
    const stillOpen = BrowserWindow.getAllWindows().some((w) => w !== win && w._filoIncognito);
    if (!stillOpen) {
      try { require('./shim/storage').resetIncognito(); } catch (_) {}
    }
  });

  return win;
}

module.exports = { createMainWindow, createIncognitoWindow, SHELL_HEIGHT };
