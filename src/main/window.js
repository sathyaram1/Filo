// Finestra principale: BrowserWindow che ospita la "shell" del browser
// (tab bar + barra indirizzi + pulsanti) e una serie di WebContentsView,
// una per ogni tab aperto.

const { BrowserWindow, session } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { TabManager } = require('./tabs');
const { registerFiloProtocolForSession } = require('./protocol');

const SHELL_HEIGHT = 88;

// Finestre invisibili durante i test automatici: perché e come, in
// `test-window-mode.js` (vale anche per menu e tooltip, che sono finestre a sé).
const { HIDDEN, posizioneFuoriSchermo, hideForTests } = require('./test-window-mode');

// Porta la finestra davanti a tutto: serve al primo disegno, perché in alcune
// configurazioni la WebContentsView appena creata non ha un display surface
// valido e resta un quadrato vuoto finché la finestra non riceve attenzione
// esplicita dal compositor. Nei test la si mostra comunque (altrimenti i menu
// nativi, che sono finestre figlie, non si aprono) ma invisibile e senza fuoco.
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

// Wiring comune a finestra normale e incognito: carica le impostazioni di
// sicurezza e collega i listener di resize/fullscreen al layout dei tab.
function wireWindowCommon(win, tabs) {
  // Carica le impostazioni di sicurezza correnti e applicale prima che si apra
  // il primo tab — così la policy WebRTC è già attiva e il popup blocker
  // funziona sul newtab e su qualunque pagina successiva.
  try {
    const Storage = globalThis.SN_STORAGE;
    if (Storage && typeof Storage.getSettings === 'function') {
      Storage.getSettings().then((s) => {
        try { tabs.setSecurity(s?.security || {}); } catch (_) {}
      }).catch(() => {});
    }
  } catch (_) {}

  win.on('resize', () => tabs.layout());
  win.on('enter-full-screen', () => tabs.layout());
  // Se l'utente esce dal fullscreen OS con un gesto/scorciatoia di sistema,
  // ripristina anche la barra (esce dalla modalità contenuto a tutto schermo).
  win.on('leave-full-screen', () => {
    if (tabs.contentFullscreen) tabs.setContentFullscreen(false);
    else tabs.layout();
  });
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 500,
    // Background diverso dal cream della shell così se la WebContentsView
    // non rende vediamo subito un'area di colore diverso (debugging visivo).
    backgroundColor: '#222222',
    title: 'Filo',
    icon: path.join(__dirname, '..', '..', 'assets', 'icons', 'icon-128.png'),
    ...(HIDDEN ? { ...posizioneFuoriSchermo(), show: false, skipTaskbar: true } : {}),
    // Chrome-like: la title bar nativa è rimossa, i controlli minimize/maximize/
    // close vivono nella tab-row della shell (vedi src/renderer/shell.html).
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'shell-preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });

  // Invisibile fin dalla nascita, non dal primo disegno: fra i due momenti
  // passano centinaia di millisecondi in cui la finestra esiste già.
  hideForTests(win, { main: true });

  win.loadURL('filo://shell/shell.html');

  const tabs = new TabManager(win, null, { shellHeight: SHELL_HEIGHT });
  win._filoTabs = tabs;

  wireWindowCommon(win, tabs);

  win.webContents.once('did-finish-load', async () => {
    // Riapre i tab della sessione precedente; se non c'è nulla da ripristinare
    // apre un newtab vuoto come sempre.
    let restored = false;
    try { restored = await tabs.restoreSession(); } catch (_) { restored = false; }
    if (!restored) tabs.openTab('filo://newtab/');
    revealWindow(win);
  });

  return win;
}

// Finestra incognito: sessione web effimera (cookie/cache/localStorage in RAM,
// svaniscono alla chiusura) + storage filo:// instradato sull'overlay in memoria
// dello shim (vedi src/main/shim/storage.js). La finestra è marcata con
// win._filoIncognito così l'IPC avvolge i suoi messaggi in runIncognito().
function createIncognitoWindow() {
  // Partizione unica e SENZA prefisso 'persist:' → sessione in memoria, isolata
  // da quella normale e da eventuali altre finestre incognito.
  const partition = 'filo-incognito-' + randomUUID();
  const ses = session.fromPartition(partition);
  // filo:// è registrato globalmente solo sulla sessione di default: i tab di
  // questa partizione non lo vedrebbero. Registriamolo qui.
  registerFiloProtocolForSession(ses);

  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 500,
    // Sfondo viola scuro: distinzione visiva immediata dalla finestra normale.
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

  // La shell legge ?incognito=1 e applica il badge + tema scuro dedicato.
  win.loadURL('filo://shell/shell.html?incognito=1');

  const tabs = new TabManager(win, null, { shellHeight: SHELL_HEIGHT, incognito: true, partition });
  win._filoTabs = tabs;

  wireWindowCommon(win, tabs);

  win.webContents.once('did-finish-load', async () => {
    tabs.openTab('filo://newtab/'); // niente restore in incognito
    revealWindow(win);
  });

  // Alla chiusura dell'ULTIMA finestra incognito, azzera l'overlay in RAM: nulla
  // di ciò che è stato scritto durante la sessione sopravvive.
  win.on('closed', () => {
    const stillOpen = BrowserWindow.getAllWindows().some((w) => w !== win && w._filoIncognito);
    if (!stillOpen) {
      try { require('./shim/storage').resetIncognito(); } catch (_) {}
    }
  });

  return win;
}

module.exports = { createMainWindow, createIncognitoWindow, SHELL_HEIGHT };
