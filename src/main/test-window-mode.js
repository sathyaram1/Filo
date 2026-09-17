// Finestre invisibili nei test (FILO_HIDE_WINDOW=1). Due difese insieme perché nessuna regge
// da sola: fuori schermo (con `show:false` i menu figli non si aprono) e opacità zero.
// test:shoot e test:smoke non la usano: lì la finestra È il risultato.

// In pixel FISICI: le coordinate sono interi a 16 bit e il numero passato a Electron è
// logico, quindi al 125% un -32000 gira di segno e la finestra torna visibile.
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
    // Uscendo dal tutto schermo il sistema rimette la finestra dov'era: via di nuovo. La
    // bandierina serve: su X11 spostarla qui riemette l'evento e si rientra all'infinito.
    let riposizionando = false;
    win.on('leave-full-screen', () => {
      if (riposizionando) return;
      riposizionando = true;
      try { const p = posizioneFuoriSchermo(); win.setPosition(p.x, p.y); win.setOpacity(0); } catch (_) {}
      riposizionando = false;
    });
    // Il giro a tutto schermo rimette l'opacità: la riaffermiamo anche lì.
    win.on('enter-full-screen', () => {
      try { win.setOpacity(0); } catch (_) {}
    });
  } catch (_) { /* best-effort: mai far fallire l'avvio per questo */ }
  return true;
}

// Nei test openExternal/openPath non aprono niente e lo dicono su stderr: su Linux senza
// desktop `xdg-open` non esce mai e l'app non si chiude più. Mai in produzione.

/** Vero se l'ambiente è quello dei test automatici. PURA. */
function inModalitaTest(env = process.env) {
  return !!env && env.NODE_ENV === 'test';
}

// Sostituisce openExternal/openPath con versioni che non aprono niente. No-op fuori dalla
// modalità test; ritorna true se ha sostituito.
function silenziaApertureDiSistema(shell, {
  inTest = inModalitaTest(),
  avvisa = (riga) => { try { process.stderr.write(riga + '\n'); } catch (_) {} },
} = {}) {
  if (!inTest || !shell) return false;
  shell.openExternal = async (url) => { avvisa(`[test] openExternal soppresso: ${url}`); };
  shell.openPath = async (p) => { avvisa(`[test] openPath soppresso: ${p}`); return ''; };
  return true;
}

module.exports = {
  HIDDEN, coordinataFuoriSchermo, posizioneFuoriSchermo, hideForTests,
  inModalitaTest, silenziaApertureDiSistema,
};
