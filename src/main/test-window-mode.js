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

// Abbastanza lontano da stare fuori da qualsiasi disposizione di monitor
// plausibile, non così tanto da uscire dai limiti che Windows accetta.
const OFFSCREEN = { x: -32000, y: -32000 };

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
    win.setPosition(OFFSCREEN.x, OFFSCREEN.y);
    // Uscendo dal tutto schermo il sistema rimette la finestra dov'era prima di
    // entrarci — cioè potenzialmente sullo schermo: riportiamola via.
    win.on('leave-full-screen', () => {
      try { win.setPosition(OFFSCREEN.x, OFFSCREEN.y); win.setOpacity(0); } catch (_) {}
    });
    // Alcune superfici rimettono l'opacità (animazioni, ripristini): il giro a
    // tutto schermo è il caso noto, quindi la riaffermiamo anche lì.
    win.on('enter-full-screen', () => {
      try { win.setOpacity(0); } catch (_) {}
    });
  } catch (_) { /* best-effort: mai far fallire l'avvio per questo */ }
  return true;
}

module.exports = { HIDDEN, OFFSCREEN, hideForTests };
