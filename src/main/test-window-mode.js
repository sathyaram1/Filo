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
    // La bandierina non è prudenza teorica: su X11 (i contenitori delle routine)
    // spostare la finestra qui dentro fa riemettere `leave-full-screen` al
    // sistema, e senza guardia il gestore rientra in se stesso finché il
    // processo non muore per stack esaurito. È la ragione per cui il tutto
    // schermo "non si poteva provare in un contenitore".
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

// NIENTE APERTURE DI SISTEMA DURANTE I TEST.
//
// `shell.openExternal(url)` e `shell.openPath(p)` chiedono al sistema di aprire
// il browser o il gestore file. Su Linux passano da `xdg-open` e ne aspettano
// l'uscita: in un contenitore senza desktop (la suite in GitHub) non esce mai,
// la promise resta appesa, l'IPC che l'aspettava non risponde e l'app non si
// chiude più (tre spec, quindici «Worker teardown timeout» nella prima corsa,
// 2026-09-16). Su Windows e Mac si apre davvero il browser di chi lancia i
// test, che non è meglio. Quindi in modalità test le due funzioni non aprono
// niente e risolvono subito — openPath con '' , che per Electron è «riuscito»
// — e lo dicono su stderr, così una prova che voglia asserirlo può leggerla:
//   [test] openExternal soppresso: <url>
//   [test] openPath soppresso: <percorso>
// Vale su ogni piattaforma e mai in produzione.
//
// La modalità test è NODE_ENV=test: la fixture e ogni spec che apre Filo per
// conto suo lo impostano (una sentinella negli unit test lo controlla per il
// fattore di scala, e la stessa lista di lanci vale qui).

/** Vero se l'ambiente è quello dei test automatici. PURA. */
function inModalitaTest(env = process.env) {
  return !!env && env.NODE_ENV === 'test';
}

/**
 * Sostituisce openExternal/openPath dello `shell` di Electron con versioni che
 * non aprono niente. No-op fuori dalla modalità test (lo shell resta com'è).
 * Ritorna true se ha sostituito.
 */
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
