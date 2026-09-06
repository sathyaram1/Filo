// Finestre invisibili durante i test automatici.
//
// PERCHÉ ESISTE
//   La suite apre e chiude Electron centinaia di volte. Vedere finestre
//   lampeggiare sullo schermo mentre si sta lavorando è il motivo per cui in
//   locale i test si evitavano — e un test che non si lancia non serve a niente.
//
// PERCHÉ DUE DIFESE E NON UNA
//   1. FUORI SCHERMO. La prima difesa. Non basta `show: false`: in Filo il menu
//      del tasto destro è una FINESTRA NATIVA figlia, e con la madre mai mostrata
//      non si apre — una dozzina di spec diventava rossa. Fuori schermo invece
//      per il sistema la finestra è viva e visibile (le figlie si aprono, il
//      compositore disegna, gli screenshot vengono): semplicemente sta in una
//      zona del desktop che nessun monitor mostra.
//   2. TRASPARENZA TOTALE. Serve perché "fuori schermo" da solo NON regge: gli
//      spec che mettono l'app a tutto schermo fanno agganciare la finestra al
//      monitor dal sistema operativo, e per qualche secondo copre davvero lo
//      schermo dell'owner (misurato: 3 lanci su 4). A opacità zero resta
//      invisibile ovunque il sistema decida di metterla.
//
//   Vale anche per le finestre FIGLIE (menu, tooltip): sono finestre a sé, con
//   la loro opacità, e in modalità a tutto schermo si aprirebbero sopra lo
//   schermo vero anche con la madre fuori campo.
//
// NON vale per `test:shoot`/`test:smoke`, che fotografano la finestra REALE
// composita: lì l'immagine È il risultato e serve una finestra vera su uno
// schermo vero. Quegli strumenti non impostano la variabile.

// Dove parcheggiare la finestra: abbastanza lontano da stare fuori da qualsiasi
// disposizione di monitor plausibile, non così tanto da uscire dai limiti che i
// sistemi accettano.
//
// Il limite è in pixel FISICI (le coordinate delle finestre viaggiano come
// interi a 16 bit, ±32767), mentre il numero che si passa a Electron è logico:
// su uno schermo al 125% un -32000 logico diventa -40000 fisici, il numero gira
// e la finestra si ritrova dall'altra parte. Misurato al 125%: chiesto -32000,
// riletto +20428, e da lì il sistema smette di aggiornare la vista dentro la
// finestra (la pagina non si accorgeva più che la finestra si era accorciata:
// tre spec del menu del tasto destro rossi solo su uno schermo scalato).
// Si divide per il fattore di scala, così il numero fisico è lo stesso ovunque.
const LONTANO_FISICO = 30000;

/** Coordinata logica di parcheggio dato il fattore di scala dello schermo. PURA. */
function coordinataFuoriSchermo(scala) {
  const s = Number.isFinite(scala) && scala > 0 ? scala : 1;
  return -Math.round(LONTANO_FISICO / s);
}

function posizioneFuoriSchermo() {
  let scala = 1;
  try {
    const { screen } = require('electron');
    scala = screen.getPrimaryDisplay().scaleFactor;
  } catch (_) { /* prima che l'app sia pronta: vale 1 */ }
  const v = coordinataFuoriSchermo(scala);
  return { x: v, y: v };
}

const HIDDEN = process.env.FILO_HIDE_WINDOW === '1';

/**
 * Rende invisibile una finestra durante i test (no-op fuori dai test).
 * `main: true` per la finestra principale: oltre alla trasparenza la sposta
 * fuori schermo e la tiene lì anche dopo un giro a tutto schermo.
 */
function hideForTests(win, { main = false } = {}) {
  if (!HIDDEN || !win) return false;
  try {
    win.setOpacity(0);
    if (!main) return true;
    const via = posizioneFuoriSchermo();
    win.setPosition(via.x, via.y);
    // Uscendo dal tutto schermo il sistema rimette la finestra dov'era prima di
    // entrarci, cioè potenzialmente sullo schermo: riportiamola via.
    win.on('leave-full-screen', () => {
      try { const p = posizioneFuoriSchermo(); win.setPosition(p.x, p.y); win.setOpacity(0); } catch (_) {}
    });
    // Alcune superfici rimettono l'opacità (animazioni, ripristini): il giro a
    // tutto schermo è il caso noto, quindi la riaffermiamo anche lì.
    win.on('enter-full-screen', () => {
      try { win.setOpacity(0); } catch (_) {}
    });
  } catch (_) { /* best-effort: mai far fallire l'avvio per questo */ }
  return true;
}

module.exports = { HIDDEN, coordinataFuoriSchermo, posizioneFuoriSchermo, hideForTests };
