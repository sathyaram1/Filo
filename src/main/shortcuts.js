// Shortcut globali — equivalente di chrome.commands ma a livello OS.
// Alt+E/T/S/H replicano i 4 comandi dell'estensione, ma valgono ovunque
// (anche con Filo in background).
//
// Quando uno shortcut si attiva, mandiamo un broadcast 'shortcut:triggered'
// alla webContents del tab attivo: il preload page-preload.js lo intercetta
// e lo gira al content script come MSG.SHORTCUT_TRIGGERED, identico al
// vecchio comportamento extension.

const { globalShortcut, BrowserWindow } = require('electron');

const COMMANDS = {
  'Alt+E': 'explain-selection',
  'Alt+T': 'translate-selection',
  'Alt+S': 'save-for-later',
  'Alt+H': 'open-help-sidebar',
};

// Su Mac le stesse quattro scorciatoie prendono un Ctrl in più.
//
// PERCHÉ: su Mac il tasto Alt si chiama Opzione e serve a SCRIVERE — è il tasto
// morto degli accenti (Opzione+E poi "e" fa "é"). Queste scorciatoie sono
// globali: valgono in tutto il sistema, non solo dentro Filo. Registrare
// Opzione+E significherebbe togliere l'accento acuto a chi scrive in italiano,
// in QUALSIASI programma, per tutto il tempo che Filo resta acceso — un danno
// molto peggiore della comodità che dà la scorciatoia. Ctrl+Opzione non ha
// questo ruolo e resta libero.
//
// La tabella qui sopra resta la forma canonica (è quella che il manifesto delle
// capacità cita e che una sentinella negli unit test incrocia): qui si aggiunge
// solo il modificatore che serve alla piattaforma.
function acceleratorePerPiattaforma(accel) {
  return process.platform === 'darwin' ? `Control+${accel}` : accel;
}

function registerShortcuts(window) {
  for (const [accel, command] of Object.entries(COMMANDS)) {
    const reale = acceleratorePerPiattaforma(accel);
    try {
      const ok = globalShortcut.register(reale, () => dispatch(command, window));
      if (!ok) console.warn('[Filo] shortcut non registrato:', reale);
    } catch (e) {
      console.warn('[Filo] register shortcut failed', reale, e);
    }
  }
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

async function saveForLater(win, tab) {
  const { handleMessage } = require('./services/handlers');
  // Fotografiamo SUBITO i dati identificativi della scheda, prima di qualsiasi
  // attesa: se la pagina naviga/redirect mentre raccogliamo metadata e
  // miniatura, tab.url/tab.title potrebbero già puntare alla nuova pagina e
  // finiremmo per salvare quella sbagliata (#334, cammino da scorciatoia).
  const url = tab.url;
  const title = tab.title;
  const favicon = tab.favicon || '';
  // Chiediamo metadata al content script (best-effort), poi catturiamo thumbnail.
  let extra = {};
  try {
    extra = await tab.view.webContents.executeJavaScript(
      '(window.__sn_collectSavePayload && window.__sn_collectSavePayload()) || {}',
      true,
    );
  } catch (_) { /* tab senza content script */ }
  let thumbnail = '';
  try {
    const img = await tab.view.webContents.capturePage();
    thumbnail = img.resize({ width: 320 }).toDataURL();
  } catch (_) {}
  await handleMessage({
    type: globalThis.SN_MSG.MSG.SAVE_PAGE,
    page: {
      url, title,
      favicon: favicon || extra.favicon,
      thumbnail,
      description: extra.description,
      excerpt: extra.excerpt,
    },
  });
  try { win._filoTabs.closeTab(tab.id); } catch (_) {}
}

module.exports = { registerShortcuts, dispatch, saveForLater, isInternalTab };
