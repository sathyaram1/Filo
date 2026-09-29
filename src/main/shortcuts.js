// Le quattro scorciatoie di Filo (Spiega, Traduci, Salva per dopo, Aiuto): valgono
// solo con Filo in primo piano, mai come scorciatoie di sistema (#838).
// Sentinella: tests/unit/scorciatoieSoloInFilo.test.mjs.

const { BrowserWindow } = require('electron');

const COMMANDS = {
  'Alt+E': 'explain-selection',
  'Alt+T': 'translate-selection',
  'Alt+S': 'save-for-later',
  'Alt+H': 'open-help-sidebar',
};

// Su Mac Opzione compone gli accenti (Opzione+E poi e = é) anche dentro Filo:
// prendersi Opzione+E toglierebbe la é a chi scrive in una pagina. Ctrl+Opzione
// è libero. COMMANDS resta la forma canonica, qui si aggiunge solo il Control.
function acceleratorePerPiattaforma(accel, piattaforma = process.platform) {
  return piattaforma === 'darwin' ? `Control+${accel}` : accel;
}

// Modificatori esatti: AltGr su Windows è Ctrl+Alt e con E scrive €, Alt+Shift
// è un'altra combinazione. Un carattere ASCII stampabile dice il tasto nel layout
// dell'utente; fuori da lì (é, €, cirillico, tasto morto, carattere di controllo)
// conta il tasto fisico.
function tastoCombacia(input, accel) {
  const parti = accel.split('+');
  const lettera = parti.pop().toLowerCase();
  if (!!input.control !== parti.includes('Control') || !!input.alt !== parti.includes('Alt')) return false;
  if (input.meta || input.shift) return false;
  const key = String(input.key || '');
  if (key.length === 1 && key > ' ' && key < '\u007f') return key.toLowerCase() === lettera;
  return String(input.code || '') === `Key${lettera.toUpperCase()}`;
}

function comandoDaTasto(input, piattaforma = process.platform) {
  if (!input || input.type !== 'keyDown') return null;
  for (const [accel, command] of Object.entries(COMMANDS)) {
    if (tastoCombacia(input, acceleratorePerPiattaforma(accel, piattaforma))) return command;
  }
  return null;
}

// Da chiamare su ogni webContents di Filo che può avere il fuoco (scheda, barra,
// menu a comparsa): il tasto arriva lì solo se Filo è davanti. `finestra` è
// quella su cui agire (o una funzione che la dà), mai un'altra finestra di Filo.
function collegaScorciatoie(wc, finestra) {
  if (!wc || typeof wc.on !== 'function') return;
  wc.on('before-input-event', (event, input) => {
    const command = comandoDaTasto(input);
    if (!command) return;
    event.preventDefault();
    // Tenuto premuto non si ripete: Alt+S chiuderebbe una scheda dopo l'altra.
    if (input.isAutoRepeat) return;
    dispatch(command, typeof finestra === 'function' ? finestra() : finestra);
  });
}

// Una tab è "interna" (pagina filo://) se il flag isInternal è settato oppure
// se l'URL usa lo schema filo://. Controlliamo entrambi perché isInternal è il
// campo canonico ma l'URL è la difesa definitiva contro tab in stati di
// transizione.
function isInternalTab(tab) {
  if (!tab) return false;
  return !!tab.isInternal || String(tab.url || '').startsWith('filo://');
}

function dispatch(command, window) {
  // Manda al webContents della tab attiva. Se è una pagina interna senza
  // content script, nessuno raccoglie: ok, è il comportamento atteso.
  const win = window || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win || !win._filoTabs) return;
  const active = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId);
  if (!active) return;

  if (command === 'save-for-later') {
    // "Salva per dopo" ha senso solo per pagine web da rileggere: le pagine
    // interne di Filo (filo://) non vanno salvate né chiuse. Early-return
    // simmetrico agli altri 3 comandi, che su una pagina interna sono già
    // no-op (nessun content script in ascolto).
    if (isInternalTab(active)) return;
    // Comportamento speciale: salva via servizio + chiude il tab.
    saveForLater(win, active).catch((e) => console.warn('[Filo] save-for-later failed', e));
    return;
  }
  const wc = active.view.webContents;
  // #405 — Spiegazione e Traduci lavorano sul testo SELEZIONATO, che può stare
  // dentro un riquadro incorporato (un video, una mappa, un blocco commenti).
  // `webContents.send` parla solo col frame principale: lì la selezione non
  // esiste e la scorciatoia sembrava rotta. Consegniamo al frame con cui
  // l'utente ha interagito per ultimo. Le altre scorciatoie riguardano la
  // scheda intera (la sidebar Aiuto) e restano al frame principale.
  const SELECTION_COMMANDS = new Set(['explain-selection', 'translate-selection']);
  let target = wc;
  if (SELECTION_COMMANDS.has(command)) {
    try {
      const frame = wc._filoActiveFrame;
      if (frame && !frame.detached) target = frame;
    } catch (_) { target = wc; }
  }
  try { target.send('shortcut:triggered', { command }); } catch (_) {
    try { wc.send('shortcut:triggered', { command }); } catch (_) {}
  }
}

// #839 — Alt+S e il menu sono la stessa azione: la fa la pagina (savePage nel content script), con la sua
// miniatura, la conferma cliccabile e la chiusura. Il main salva da solo solo se la pagina non la prende.
const ATTESA_RICEVUTA_MS = 3500;
const ricevuteInAttesa = new Map();

function consegnaConRicevuta(tab, command, attesaMs = ATTESA_RICEVUTA_MS) {
  return new Promise((resolve) => {
    const ricevuta = crypto.randomUUID();
    const chiudi = (presa) => {
      clearTimeout(timer);
      ricevuteInAttesa.delete(ricevuta);
      resolve(presa);
    };
    const timer = setTimeout(() => chiudi(false), attesaMs);
    ricevuteInAttesa.set(ricevuta, { tabId: tab.id, chiudi });
    try { tab.view.webContents.send('shortcut:triggered', { command, ricevuta }); } catch (_) { chiudi(false); }
  });
}

// La ricevuta vale solo dalla scheda a cui era stata consegnata.
function riceviRicevuta(ricevuta, tabId, presa) {
  const attesa = ricevuteInAttesa.get(ricevuta);
  if (!attesa || attesa.tabId !== tabId) return false;
  attesa.chiudi(!!presa);
  return true;
}

async function saveForLater(win, tab) {
  const { handleMessage } = require('./services/handlers');
  const { dallaScheda } = require('./services/miniature');
  const { MSG } = globalThis.SN_MSG;
  // I dati della scheda si fotografano prima di ogni attesa: un redirect intanto farebbe salvare la pagina sbagliata (#334).
  const url = tab.url;
  const title = tab.title;
  const favicon = tab.favicon || '';
  if (await consegnaConRicevuta(tab, 'save-for-later')) return;
  // Pagina senza Filo dentro (sito escluso, ancora in caricamento, bloccata): si salva comunque, prima della miniatura.
  const res = await handleMessage({ type: MSG.SAVE_PAGE, page: { url, title, favicon } });
  const thumbnail = await dallaScheda(tab.view.webContents);
  if (thumbnail && res?.entry?.id) await globalThis.SN_SAVED_PAGES.setThumbnail(res.entry.id, thumbnail);
  try { win._filoTabs.closeTab(tab.id); } catch (_) {}
}

module.exports = { collegaScorciatoie, comandoDaTasto, dispatch, saveForLater, consegnaConRicevuta, riceviRicevuta, isInternalTab, acceleratorePerPiattaforma, COMMANDS };
