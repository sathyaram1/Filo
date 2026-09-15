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

// Serve al primo disegno: in certe configurazioni la WebContentsView appena
// creata resta un quadrato vuoto finché la finestra non riceve attenzione dal
// compositor. Nei test si mostra lo stesso (i menu nativi sono finestre figlie
// e senza madre mostrata non si aprono), ma invisibile e senza fuoco.
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
  // A tutto schermo per una strada che non è quella di Filo (gesto o tasto del
  // sistema) si adotta comunque la modalità: altrimenti resta uno schermo intero
  // che Filo non sa di avere, e l'Esc non ha niente da spegnere.
  win.on('enter-full-screen', () => {
    if (!tabs.contentFullscreen) tabs.setContentFullscreen(true);
    else tabs.layout();
  });
  // Se l'utente esce dal fullscreen OS con un gesto/scorciatoia di sistema,
  // ripristina anche la barra (esce dalla modalità contenuto a tutto schermo).
  win.on('leave-full-screen', () => {
    if (tabs.contentFullscreen) tabs.setContentFullscreen(false);
    else tabs.layout();
  });

  // Esc esce dallo schermo intero anche quando il fuoco è sulla barra di Filo
  // (#514). A tutto schermo la barra è nascosta sotto la pagina, ma tiene il
  // fuoco se l'ultimo clic era lì — barra indirizzi, un pulsante, il menu su
  // Mac: da lì il tasto non passa da nessun before-input-event delle schede, e
  // prima moriva nel nulla. La regola sta in un posto solo (tabs.js); qui non si
  // decide niente, si porta il tasto dove si decide. Quando la barra è visibile
  // handleFullscreenEscape risponde false e l'Esc resta a chi lo usa nella barra
  // (il pannello degli scaricamenti si chiude ancora con Esc).
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
