// Finestra principale e finestra incognito: la BrowserWindow che ospita la
// shell (barra in alto) e una WebContentsView per ogni scheda.

const { BrowserWindow, session } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { TabManager } = require('./tabs');
const { collegaScorciatoie } = require('./shortcuts');
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

// Chi deve sapere che è nata una finestra normale fuori dall'avvio (il main ci
// tiene il suo riferimento): senza, resterebbe puntato a una finestra chiusa.
const osservatoriFinestraNormale = [];
function onFinestraNormale(cb) { if (typeof cb === 'function') osservatoriFinestraNormale.push(cb); }

// Durante la chiusura di Filo una finestra nuova annullerebbe l'uscita: chi ha
// chiesto di uscire se lo vedrebbe riaprire da solo.
let inChiusura = false;
try { require('electron').app.on('before-quit', () => { inChiusura = true; }); } catch (_) {}

// Suono e pulsante che ferma vivono in una finestra che la scadenza la vede, e
// non è detto che ce ne sia una: senza garanzia il timer resta vivo e muto.
function assicuraFinestraNormale() {
  const esistente = BrowserWindow.getAllWindows().find((w) => {
    try { return !w.isDestroyed() && !!w._filoTabs && !w._filoIncognito; } catch (_) { return false; }
  });
  if (esistente) return esistente;
  if (inChiusura) return null;
  const win = createMainWindow();
  for (const cb of osservatoriFinestraNormale) { try { cb(win); } catch (_) {} }
  return win;
}

// Wiring comune a finestra normale e incognito: carica le impostazioni di
// sicurezza e collega i listener di resize/fullscreen al layout dei tab.
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

  // Chiudere la finestra distrugge le schede senza chiudere le loro pagine, e prima di `before-quit`: chi aveva
  // caselle da spedire perdeva l'ultima modifica. Si aspetta come alla chiusura di una scheda (chiusuraConCaselle).
  let congedoChiusuraFatto = false;
  win.on('close', (e) => {
    if (congedoChiusuraFatto) return;
    congedoChiusuraFatto = true;
    const attesa = require('./tabs/chiusuraConCaselle').congedaSchede(tabs);
    if (!attesa) return;
    e.preventDefault();
    const chiudi = () => { try { if (!win.isDestroyed()) win.close(); } catch (_) {} };
    attesa.then(chiudi, chiudi);
  });

  win.on('resize', () => tabs.layout());
  // Se si chiude la finestra che stava suonando, il turno passa a un'altra:
  // senza questo avviso il rumore morirebbe con la finestra, scadenza viva.
  win.on('closed', () => {
    try { require('./services/handlers').broadcastLiveUpdate(); } catch (_) {}
  });
  // Se la finestra va a tutto schermo per una strada che non è quella di Filo
  // (gesto o scorciatoia del sistema, gestore finestre), adottiamo la modalità
  // invece di limitarci al layout: altrimenti resterebbe uno schermo intero che
  // Filo non sa di avere, e l'Esc non avrebbe niente da spegnere. Le due cose
  // sono la stessa cosa nei due versi — l'uscita era già simmetrica qui sotto.
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
    // La barra laterale prima: il suo tasto, e l'Esc che la chiude prima di uscire dalla modalità.
    if (tabs.barra && tabs.barra.tasto(input)) { event.preventDefault(); return; }
    if (input.type !== 'keyDown' || input.key !== 'Escape') return;
    if (tabs.handleFullscreenEscape(null)) event.preventDefault();
  });
  // Spiega, Traduci, Salva per dopo e Aiuto anche col fuoco sulla barra.
  collegaScorciatoie(win.webContents, win);

  // Il menu a comparsa nasce con la barra pronta: il primo clic lo trova carico (#1090). Il setTimeout fa partire prima il ripristino delle schede.
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => { try { require('./popup-menu').preparaMenu(win); } catch (_) {} }, 0);
  });

  // Indietro e avanti senza tastiera (#685). Le due strade non si sovrappongono
  // mai — Electron manda gli app-command su Windows e Linux, lo swipe su Mac —
  // quindi si ascoltano tutte e due senza ramo di piattaforma: una `if` su
  // win32 qui lascerebbe scoperto uno dei due sistemi.
  //   · tasti laterali del mouse → app-command browser-backward/forward;
  //   · scorrimento orizzontale a due dita su Mac → swipe (l'utente lo accende
  //     nelle impostazioni di sistema; se è spento l'evento non arriva e basta).
  // Dove andare lo decide tabs.navigaCronologia: senza cronologia è un no-op.
  // Indietro e avanti da qui sono la stessa azione contata della barra e dei tasti (#1461).
  const naviga = (verso) => require('./services/azioniContate').azione('navigate-back-forward', () => tabs.navigaCronologia(verso), { incognito: !!win._filoIncognito });
  win.on('app-command', (event, comando) => {
    if (comando === 'browser-backward') naviga('indietro');
    else if (comando === 'browser-forward') naviga('avanti');
    else return;
    // Senza questo Windows lascia agire anche il comportamento di serie.
    try { event.preventDefault(); } catch (_) {}
  });
  // La direzione è quella delle dita: si spinge la pagina a destra per tornare
  // indietro, come in ogni browser su Mac.
  win.on('swipe', (event, direzione) => {
    if (direzione === 'right') naviga('indietro');
    else if (direzione === 'left') naviga('avanti');
  });
}

// Il tempo di avvio di Filo (#1461): dall'inizio del processo alla finestra visibile, e alla prima scheda caricata.
// Solo la prima finestra del processo: le altre si aprono a Filo già avviato.
let avvioContato = false;
function misuraAvvio() {
  if (avvioContato) return null;
  avvioContato = true;
  try {
    const C = globalThis.SN_CONTATORI_MAIN;
    return C ? C.azione('avvio', { t0: Date.now() - process.uptime() * 1000, incognito: false }) : null;
  } catch (_) { return null; }
}

function createMainWindow() {
  const avvio = misuraAvvio();
  const tCrea = Date.now();
  const contatori = () => globalThis.SN_CONTATORI_MAIN || null;
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
      // shell-preload.js chiede solo electron: la shell non ha bisogno di Node (#834).
      sandbox: true,
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
  // Quando non risponde, e lo spegnimento del sistema su Windows, che non passa dall'uscita (#1466).
  try { contatori()?.seguiFinestra(win); } catch (_) {}
  win.on('session-end', () => { try { contatori()?.fineChiusura({ sistema: true }); } catch (_) {} });

  win.webContents.once('did-finish-load', async () => {
    // I passi dell'avvio (#1466) solo per la prima finestra del processo, come il tempo di avvio.
    const passo = (nome, t0) => { if (avvio) { try { contatori()?.passoAvvio(nome, Date.now() - t0); } catch (_) {} } };
    passo('finestra_creata', tCrea);
    const tSessione = Date.now();
    let restored = false;
    try { restored = await tabs.restoreSession(); } catch (_) { restored = false; }
    if (!restored) tabs.openTab('filo://newtab/');
    passo('sessione_ripristinata', tSessione);
    revealWindow(win);
    if (avvio) {
      avvio.visto();
      const davanti = tabs.tabs.find((t) => t.id === tabs.activeId);
      const wc = davanti && davanti.view && davanti.view.webContents;
      try { contatori()?.passoAvvioFino('prima_scheda_visibile', Date.now(), wc); } catch (_) {}
      if (wc && !wc.isDestroyed() && wc.isLoading()) avvio.scheda(wc);
      else avvio.fine();
    }
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
  try { require('./services/cookies').coverAdblock(ses); } catch (_) {}

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
      // shell-preload.js chiede solo electron: la shell non ha bisogno di Node (#834).
      sandbox: true,
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
    // Niente restore in incognito. Una scheda aperta qui prima che la barra finisse di caricarsi resta davanti.
    if (!tabs.tabs.length) tabs.openTab('filo://newtab/');
    revealWindow(win);
  });

  // Solo alla chiusura dell'ULTIMA incognito: le altre stanno ancora leggendo
  // lo stesso overlay in RAM.
  win.on('closed', () => {
    try { require('./services/downloads').forgetScope(partition); } catch (_) {}
    const stillOpen = BrowserWindow.getAllWindows().some((w) => w !== win && w._filoIncognito && w._filoTabs);
    if (!stillOpen) {
      try { require('./shim/storage').resetIncognito(); } catch (_) {}
      try { require('./services/ilFilo').resetIncognito(); } catch (_) {}
      try { require('./services/contestoFilo').dimenticaIncognito(); } catch (_) {}
      try { globalThis.SN_HISTORY.resetIncognito(); } catch (_) {}
      try { require('./services/cookies').resetIncognito(); } catch (_) {}
      try { require('./services/fingerprint').resetIncognito(); } catch (_) {}
    }
  });

  return win;
}

module.exports = {
  createMainWindow, createIncognitoWindow, revealWindow, SHELL_HEIGHT,
  assicuraFinestraNormale, onFinestraNormale,
};
