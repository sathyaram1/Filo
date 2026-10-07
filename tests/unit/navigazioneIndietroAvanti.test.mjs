// #685 — indietro e avanti con le strade di ogni browser: Alt+freccia (Cmd+[ e
// Cmd+] su Mac), i tasti laterali del mouse, lo scorrimento a due dita su Mac.
//
// Qui sta la parte che si può chiedere a macchina: la REGOLA (quale
// combinazione, su quale sistema, e come si chiama) e il fatto che ogni porta
// sia davvero attaccata. Che la scheda torni indietro davvero lo prova
// tests/nav-indietro-avanti.spec.mjs, che apre Filo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'tasti.js'));
const T = globalThis.SN_TASTI;

// L'evento arriva in due forme: quella del DOM (altKey) e quella di
// `before-input-event` del main (alt). La regola deve leggerle entrambe.
const dom = (o) => o;
const main = (o) => {
  const m = {};
  for (const [k, v] of Object.entries(o)) {
    m[{ altKey: 'alt', ctrlKey: 'control', metaKey: 'meta', shiftKey: 'shift' }[k] || k] = v;
  }
  return m;
};

test('su Windows e Linux indietro e avanti sono Alt+freccia', () => {
  for (const forma of [dom, main]) {
    for (const sistema of ['win32', 'linux']) {
      assert.equal(T.comandoNavigazione(forma({ altKey: true, code: 'ArrowLeft' }), sistema), 'indietro');
      assert.equal(T.comandoNavigazione(forma({ altKey: true, code: 'ArrowRight' }), sistema), 'avanti');
      // La freccia senza Alt scorre la pagina, e resta sua.
      assert.equal(T.comandoNavigazione(forma({ code: 'ArrowLeft' }), sistema), null);
      // AltGr sui layout europei è Ctrl+Alt: mentre si scrive non deve navigare.
      assert.equal(T.comandoNavigazione(forma({ altKey: true, ctrlKey: true, code: 'ArrowLeft' }), sistema), null);
      // Alt+Shift+freccia seleziona per parole nei campi di testo.
      assert.equal(T.comandoNavigazione(forma({ altKey: true, shiftKey: true, code: 'ArrowLeft' }), sistema), null);
      assert.equal(T.comandoNavigazione(forma({ altKey: true, code: 'ArrowUp' }), sistema), null);
    }
  }
  assert.equal(T.comandoNavigazione(null, 'win32'), null);
  assert.equal(T.comandoNavigazione({}, 'win32'), null);
});

test('su Mac sono Cmd+[ e Cmd+], e Alt+freccia resta al cursore', () => {
  for (const forma of [dom, main]) {
    assert.equal(T.comandoNavigazione(forma({ metaKey: true, code: 'BracketLeft' }), 'darwin'), 'indietro');
    assert.equal(T.comandoNavigazione(forma({ metaKey: true, code: 'BracketRight' }), 'darwin'), 'avanti');
    // IL punto della regola: su Mac Opzione+freccia sposta il cursore di una
    // parola in ogni campo di testo. Se Filo se la prendesse, quel movimento
    // sparirebbe in tutta l'app.
    assert.equal(T.comandoNavigazione(forma({ altKey: true, code: 'ArrowLeft' }), 'darwin'), null);
    assert.equal(T.comandoNavigazione(forma({ metaKey: true, shiftKey: true, code: 'BracketLeft' }), 'darwin'), null);
    // E la parentesi da sola scrive: senza Cmd non è un comando.
    assert.equal(T.comandoNavigazione(forma({ code: 'BracketLeft' }), 'darwin'), null);
  }
  // Su Windows Ctrl+[ non è indietro: lì il tasto è un altro.
  assert.equal(T.comandoNavigazione({ ctrlKey: true, code: 'BracketLeft' }, 'win32'), null);
});

test('il tasto si legge dal codice fisico, ma gli eventi sintetici passano da key', () => {
  assert.equal(T.comandoNavigazione({ altKey: true, key: 'ArrowLeft' }, 'win32'), 'indietro');
  assert.equal(T.comandoNavigazione({ metaKey: true, key: ']' }, 'darwin'), 'avanti');
});

test('il nome che l\'utente legge è quello che funziona sul suo sistema', () => {
  assert.equal(T.etichettaIndietro('win32'), 'Alt+←');
  assert.equal(T.etichettaAvanti('linux'), 'Alt+→');
  assert.equal(T.etichettaIndietro('darwin'), 'Cmd+[');
  assert.equal(T.etichettaAvanti('darwin'), 'Cmd+]');
  // La barra dei menu vuole i nomi di Electron, non i simboli.
  assert.equal(T.acceleratoreElectron('Alt+←', 'win32'), 'Alt+Left');
  assert.equal(T.acceleratoreElectron('Alt+→', 'darwin'), 'Cmd+]');
});

test('chi si assegna una scorciatoia sa che queste sono già prese', () => {
  // Filo le intercetta prima della pagina: assegnarle a un modulo dell'Editor
  // vorrebbe dire salvarle e non vederle partire mai.
  for (const scritta of ['Alt+←', 'Alt+Left', 'Alt+ArrowLeft', 'Alt+→', 'Alt+Right']) {
    assert.equal(T.riservato(scritta, 'win32'), true, `${scritta} risulta libera su Windows`);
  }
  for (const scritta of ['Cmd+[', 'Ctrl+[', 'Cmd+]']) {
    assert.equal(T.riservato(scritta, 'darwin'), true, `${scritta} risulta libera su Mac`);
  }
  // E all'incontrario: su Mac Alt+freccia arriva alla pagina, su Windows Ctrl+[.
  assert.equal(T.riservato('Alt+←', 'darwin'), false);
  assert.equal(T.riservato('Ctrl+[', 'win32'), false);
});

// ── Tutte le porte sono attaccate ──────────────────────────────────────────
// La regola da sola non naviga niente: il difetto della segnalazione era
// proprio che nessuno la ascoltava. Queste righe tengono agganciati i punti in
// cui il comando entra.

const sorgente = (...parti) => readFileSync(join(ROOT, ...parti), 'utf8');

test('i tasti arrivano sia dalla pagina sia dalla barra di Filo', () => {
  const tabs = sorgente('src', 'main', 'tabs.js');
  assert.match(tabs, /comandoNavigazione/, 'tabs.js non chiede più la regola a src/shared/tasti.js');
  // Due porte: la webContents della scheda (fuoco nella pagina) e quella della
  // shell (fuoco sulla fila delle schede, dopo un clic lì). Coprirne una sola è
  // l'asimmetria che aveva già ucciso Ctrl+T/W/L/R e lo zoom.
  const usi = tabs.match(/comandoNavigazione\(/g) || [];
  assert.ok(usi.length >= 2, `la regola è ascoltata in ${usi.length} punto/i: manca il fuoco sulla barra o quello sulla pagina`);
  assert.match(tabs, /navigaCronologia\(verso/, 'tabs.js non manda il comando alla porta unica');
});

test('i tasti laterali del mouse e lo scorrimento a due dita sono attaccati', () => {
  const win = sorgente('src', 'main', 'window.js');
  assert.match(win, /'app-command'/, 'nessuno ascolta i tasti laterali del mouse (Windows e Linux)');
  assert.match(win, /browser-backward/, 'manca il comando "indietro" del mouse');
  assert.match(win, /browser-forward/, 'manca il comando "avanti" del mouse');
  assert.match(win, /'swipe'/, 'nessuno ascolta lo scorrimento a due dita (Mac)');
  // La direzione è quella delle dita: si spinge la pagina a destra per tornare
  // indietro. Invertirla manderebbe avanti chi voleva tornare.
  assert.match(win, /direzione === 'right'\) tabs\.navigaCronologia\('indietro'\)/);
  assert.match(win, /direzione === 'left'\) tabs\.navigaCronologia\('avanti'\)/);
});

test('la barra dei menu del Mac chiama la stessa porta', () => {
  const menu = sorgente('src', 'main', 'menu.js');
  assert.match(menu, /label: 'Indietro'/);
  assert.match(menu, /label: 'Avanti'/);
  assert.match(menu, /navigaCronologia\('indietro'/);
  assert.match(menu, /navigaCronologia\('avanti'/);
  // Il nome del tasto non si scrive a mano nemmeno qui.
  assert.match(menu, /acceleratoreElectron/);
});

test('il manifesto e l\'elenco delle scorciatoie dicono le stesse strade', () => {
  require(join(ROOT, 'src', 'shared', 'capabilities.js'));
  const voce = globalThis.SN_CAPABILITIES.get('navigate-back-forward');
  assert.ok(voce, 'la voce indietro/avanti è sparita dal manifesto');
  const testo = `${voce.invoke} ${voce.desc}`;
  for (const pezzo of ['Alt+←', 'Alt+→', 'Cmd+[', 'Cmd+]', 'mouse']) {
    assert.ok(testo.includes(pezzo), `il manifesto non cita ${pezzo}`);
  }
  // L'elenco delle scorciatoie deve chiedere il nome alla regola, non scriverlo.
  assert.match(sorgente('src', 'pages', 'options', 'altro.js'), /etichettaIndietro/,
    'l\'elenco delle scorciatoie non mostra indietro/avanti (o si scrive il tasto a mano)');
});
