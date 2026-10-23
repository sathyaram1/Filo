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

// Fuori schermo, da Electron 44 su X11 la finestra disegna un fotogramma e poi aspetta un vsync che non arriva:
// requestAnimationFrame si ferma, e Playwright, che prima di un clic aspetta due fotogrammi fermi, non clicca più.
// Va chiesto prima di `ready`, quando nasce il processo che disegna.
function disegnaAncheFuoriSchermo(app, { nascoste = HIDDEN } = {}) {
  if (!nascoste || !app) return false;
  try { app.commandLine.appendSwitch('disable-frame-rate-limit'); return true; } catch (_) { return false; }
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
 * Sostituisce openExternal/openPath/showItemInFolder dello `shell` di Electron con versioni che
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
  // Anche il gestore file con il file selezionato: su Linux passa da DBus o da xdg-open come openPath.
  shell.showItemInFolder = (p) => { avvisa(`[test] showItemInFolder soppresso: ${p}`); };
  return true;
}

// Nelle macchine dei test non c'è una scheda grafica, e da Electron 44 Chromium non ripiega più da solo sul disegno
// in software: WebGL mancherebbe, e le prove della protezione dal fingerprinting non avrebbero niente da provare.
function webglAncheSenzaScheda(app, { inTest = inModalitaTest() } = {}) {
  if (!inTest || !app) return false;
  try { app.commandLine.appendSwitch('enable-unsafe-swiftshader'); return true; } catch (_) { return false; }
}

module.exports = {
  HIDDEN, coordinataFuoriSchermo, posizioneFuoriSchermo, hideForTests, disegnaAncheFuoriSchermo,
  inModalitaTest, silenziaApertureDiSistema, webglAncheSenzaScheda,
};
