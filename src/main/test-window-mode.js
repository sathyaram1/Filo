// Finestre invisibili nei test (FILO_HIDE_WINDOW=1). Due difese insieme perché
// nessuna regge da sola: fuori schermo (con `show:false` i menu nativi figli non
// si aprono) e opacità zero, anche sulle figlie (a tutto schermo il sistema
// riaggancia la finestra a un monitor vero). test:shoot/test:smoke non la usano:
// lì la finestra È il risultato.

// In pixel FISICI: le coordinate delle finestre sono interi a 16 bit (±32767) e
// il numero passato a Electron è logico, quindi su uno schermo al 125% un -32000
// logico diventa -40000 fisici, gira di segno e la finestra torna visibile.
const LONTANO_FISICO = 30000;

/** Coordinata LOGICA di parcheggio, dato il fattore di scala. Pura. */
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

/** No-op fuori dai test. `main: true` aggiunge il fuori schermo e lo ridifende. */
function hideForTests(win, { main = false } = {}) {
  if (!HIDDEN || !win) return false;
  try {
    win.setOpacity(0);
    if (!main) return true;
    const via = posizioneFuoriSchermo();
    win.setPosition(via.x, via.y);
    // Uscendo dal tutto schermo il sistema rimette la finestra dov'era: via di
    // nuovo. La bandierina è obbligatoria: su X11 spostarla qui dentro riemette
    // `leave-full-screen` e senza guardia si rientra fino allo stack esaurito.
    let riposizionando = false;
    win.on('leave-full-screen', () => {
      if (riposizionando) return;
      riposizionando = true;
      try { const p = posizioneFuoriSchermo(); win.setPosition(p.x, p.y); win.setOpacity(0); } catch (_) {}
      riposizionando = false;
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
