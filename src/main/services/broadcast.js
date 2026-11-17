// Gli annunci del main alle schede e alle pagine di Filo (broadcastToTabs, broadcastToFiloPages, broadcastLiveUpdate).
// Libreria nata da handlers.js: niente registrazioni di messaggi qui.

const { BrowserWindow } = require('electron');
const { isFilo, azioneAmmessaDa, spingiAllaScheda, spingiAllaFinestra } = require('./impostazioniPerOrigine');
const { vistePerAnnunci } = require('../tabs/riservaNuovaScheda');
const { SN_CONST, SN_MSG } = globalThis;
const { MSG } = SN_MSG;

// Le capacità che l'agente conosce dipendono da chi usa Filo: Red Team (#896), Bacheca e Mazzi (#1592) in pausa
// solo a chi li vede.
function cancelliAperti() {
  const aperti = {};
  try { aperti.redteam = require('./redteamGate').visibile(); } catch (_) {}
  try { Object.assign(aperti, require('./inPausa').aperti()); } catch (_) {}
  try { aperti.streaming = require('./funzioniBuild').salvaVideoInStreaming; } catch (_) {}
  return aperti;
}

function broadcastLiveUpdate() {
  broadcastToTabs({ type: MSG.FILO_LIVE_UPDATED });
}

function broadcastToTabs(message, { soloNormali = false } = {}) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (soloNormali && win._filoIncognito) continue;
      for (const { wc, inVista } of vistePerAnnunci(win._filoTabs)) {
        try { spingiAllaScheda(wc, message, { inVista }); } catch (_) {}
      }
      spingiAllaFinestra(win, message);
    }
  } catch (_) {}
}

// Broadcast alle sole pagine INTERNE (`filo://`) e alla shell.
//
// `broadcastToTabs` parla a tutte le schede; ai siti arrivano solo i tipi che il
// loro content script ascolta (`messaggioPerDestinazione`). Questa strada è per
// chi vuole dirlo esplicitamente: un dato dell'owner (l'elenco delle fusioni in
// attesa ha nomi di rami e percorsi di file) non passa mai il confine. Se un
// sito non lo può CHIEDERE, non glielo si manda nemmeno da soli.
//
// Il frame principale basta: qui non ci sono destinatari nei riquadri
// incorporati (le pagine filo:// non ne ospitano di privilegiati). Anche fra le
// finestre solo quelle di Filo: un popup di accesso è la pagina di un sito.
//
// `message` può essere una funzione dell'ambito della finestra (quello degli scaricamenti: '' o la partizione
// incognito) che dà il messaggio per quella finestra, o null per saltarla: così l'incognito resta separato.
function broadcastToFiloPages(message) {
  const aFilo = (wc, m) => {
    try {
      if (wc && !wc.isDestroyed?.() && isFilo(wc.getURL())) wc.send('filo:broadcast', m);
    } catch (_) {}
  };
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      const m = typeof message === 'function' ? message(ambitoDellaFinestra(win)) : message;
      if (m == null) continue;
      for (const { wc } of vistePerAnnunci(win._filoTabs)) aFilo(wc, m);
      aFilo(win.webContents, m);
    }
  } catch (_) {}
}
function ambitoDellaFinestra(win) {
  try { return require('./downloads').scopeOfWindow(win); } catch (_) { return ''; }
}
// Le carte della home si annunciano solo alle finestre dell'ambito di chi le ha mosse: in incognito la
// disposizione vive in memoria, e la finestra normale non deve vederla cambiare.
function annunciaCarteHome(layout, sender) {
  const ambito = ambitoDellaFinestra(sender && sender.win);
  broadcastToFiloPages((a) => (a === ambito ? { type: MSG.CARTE_HOME_CAMBIATE, layout } : null));
}
// La prima icona trovata da una scheda, per le righe della chat disegnate prima (#848): solo al suo ambito, così
// l'incognito non dice alla finestra normale quali siti apre.
function annunciaIconaScheda(win, sito, dato) {
  const ambito = ambitoDellaFinestra(win);
  broadcastToFiloPages((a) => (a === ambito ? { type: MSG.ICONA_SCHEDA, sito, dato } : null));
}

module.exports = {
  cancelliAperti,
  broadcastLiveUpdate,
  broadcastToTabs,
  broadcastToFiloPages,
  ambitoDellaFinestra,
  annunciaCarteHome,
  annunciaIconaScheda,
};
