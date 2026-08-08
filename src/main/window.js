// Finestra principale: BrowserWindow che ospita la "shell" del browser
// (tab bar + barra indirizzi + pulsanti) e una serie di WebContentsView,
// una per ogni tab aperto.

const { BrowserWindow, session } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { TabManager } = require('./tabs');
const { registerFiloProtocolForSession } = require('./protocol');

const SHELL_HEIGHT = 88;

// Finestra FUORI SCHERMO (solo test automatici). Una suite che apre e chiude
// Electron decine di volte fa lampeggiare finestre e ruba il fuoco a chi sta
// lavorando: in locale è il motivo per cui i test si evitavano.
//
// PERCHÉ FUORI SCHERMO E NON NASCOSTA. Con `show: false` il primo tentativo
// funzionava per il DOM ma rompeva i menu contestuali: in Filo il menu del tasto
// destro è una FINESTRA NATIVA figlia, e con la madre mai mostrata non si apre
// né si posiziona — una dozzina di spec diventava rossa. Fuori schermo invece la
// finestra è a tutti gli effetti visibile per il sistema (le figlie si aprono, il
// compositore disegna, gli screenshot vengono), semplicemente in una zona del
// desktop virtuale che nessun monitor mostra. Non entra nemmeno nella barra
// delle applicazioni e non prende mai il fuoco.
//
// NON usarlo per `test:shoot`/`smoke`, che fotografano la finestra REALE: lì
// l'immagine È il risultato e va composta su uno schermo vero.
const HIDDEN = process.env.FILO_HIDE_WINDOW === '1';
// Abbastanza lontano da stare fuori da qualsiasi disposizione di monitor
// plausibile, non così tanto da uscire dai limiti che Windows accetta.
const OFFSCREEN = { x: -32000, y: -32000 };

// Porta la finestra davanti a tutto: serve al primo disegno, perché in alcune
// configurazioni la WebContentsView appena creata non ha un display surface
// valido e resta un quadrato vuoto finché la finestra non riceve attenzione
// esplicita dal compositor. Fuori schermo la si mostra comunque (altrimenti si
// ricade nel caso "nascosta", coi menu nativi rotti) ma SENZA rubare il fuoco.
function revealWindow(win) {
  try {
    if (HIDDEN) {
      win.setPosition(OFFSCREEN.x, OFFSCREEN.y);
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
    show: !HIDDEN,
    skipTaskbar: HIDDEN,
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
    show: !HIDDEN,
    skipTaskbar: HIDDEN,
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
