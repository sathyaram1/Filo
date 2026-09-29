// Sentinella #545: una scorciatoia scritta si legge in un posto solo (SN_TASTI),
// con le stesse regole con cui si riconosce il tasto premuto. Ogni lettura fatta
// in casa ha salvato tasti che poi non partivano mai.
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

test('la pressione descritta da un nome scritto è quella che il tasto vero fa combaciare', () => {
  for (const [scritta, premuta] of [
    ['Ctrl+Minus', { ctrlKey: true, key: '-' }],
    ['Ctrl++', { ctrlKey: true, key: '+' }],
    ['Ctrl+Plus', { ctrlKey: true, key: '=' }],
    ['Cmd+Maiusc+S', { metaKey: true, shiftKey: true, key: 'S', code: 'KeyS' }],
    ['Ctrl+Barra spaziatrice', { ctrlKey: true, key: ' ', code: 'Space' }],
  ]) {
    const p = T.pressioneScritta(scritta);
    assert.ok(p, `${scritta} descrive una pressione`);
    assert.ok(T.combacia(p, scritta), `${scritta}: la pressione descritta combacia col nome`);
    assert.ok(T.combacia(premuta, scritta), `${scritta}: il tasto vero combacia`);
  }
  assert.equal(T.pressioneScritta('Ctrl+Minus').key, '-');
  assert.equal(T.pressioneScritta('Ctrl+Shift+Minus').shiftKey, true);
  assert.equal(T.pressioneScritta('Ctrl++').key, '+');
  assert.equal(T.pressioneScritta('Ctrl+=').key, '+');
  assert.equal(T.pressioneScritta('b'), null, 'una lettera nuda non è una scorciatoia');
});

test('l\'Editor non spezza a mano il nome di una scorciatoia', () => {
  const src = readFileSync(join(ROOT, 'src', 'pages', 'editor', 'editor.js'), 'utf8');
  assert.doesNotMatch(src, /split\(\s*['"]\+['"]\s*\)/,
    'il nome di una scorciatoia si legge con SN_TASTI.pressioneScritta, non con uno split fatto in casa');
});

test('di un simbolo conta il carattere che arriva, non Shift', () => {
  const premi = (o) => ({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...o });
  // Americana: la barra verticale è Shift+barra rovesciata. Italiana: la barra è Shift+7.
  assert.ok(T.combacia(premi({ shiftKey: true, key: '|', code: 'Backslash' }), 'Ctrl+|'));
  assert.ok(T.combacia(premi({ shiftKey: true, key: '/', code: 'Digit7' }), 'Ctrl+/'));
  assert.ok(T.combacia(premi({ key: '.', code: 'Period' }), 'Ctrl+.'));
  assert.equal(T.combacia(premi({ shiftKey: true, key: '|', code: 'Backslash' }), 'Ctrl+\\'), false);
  assert.equal(T.combacia(premi({ altKey: true, key: '|' }), 'Ctrl+|'), false, 'Alt conta ancora');
  // Lettere, cifre, frecce e tasti con nome tengono Shift.
  assert.equal(T.combacia(premi({ key: 'ArrowUp' }), 'Ctrl+Shift+Up'), false);
  assert.equal(T.combacia(premi({ key: '1', code: 'Digit1' }), 'Ctrl+Shift+1'), false);
});

test('un simbolo con un modificatore che lo cambia si riconosce prima di salvarlo', () => {
  for (const sistema of ['win32', 'darwin', 'linux']) {
    for (const scritto of ['Ctrl+Shift+\\', 'Ctrl+Maiusc+/', 'Cmd+Shift+,', 'Ctrl+Shift+ò', 'Ctrl+Shift+Minus']) {
      assert.equal(T.modificatoreCheCambiaSimbolo(scritto, sistema), 'Shift', `${scritto} su ${sistema}`);
    }
    for (const ok of ['Ctrl+|', 'Ctrl+Shift+1', 'Ctrl+Shift+S', 'Ctrl+Shift+Up', 'Ctrl+Shift+Space', 'Ctrl+Shift+F5', 'Ctrl+Alt+E', '', 'b']) {
      assert.equal(T.modificatoreCheCambiaSimbolo(ok, sistema), '', `${ok} su ${sistema}`);
    }
  }
  // AltGr su Windows è Ctrl+Alt (Ctrl+Alt+è scrive «[»); su Mac Alt scrive.
  assert.equal(T.modificatoreCheCambiaSimbolo('Ctrl+Alt+è', 'win32'), 'Ctrl+Alt');
  assert.equal(T.modificatoreCheCambiaSimbolo('Ctrl+Alt+è', 'linux'), '');
  assert.equal(T.modificatoreCheCambiaSimbolo('Alt+.', 'darwin'), 'Alt');
  assert.equal(T.modificatoreCheCambiaSimbolo('Alt+.', 'win32'), '');
});

test('senza «+» il trattino e lo spazio separano i pezzi, e i soli modificatori si riconoscono', () => {
  const premi = (o) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
  const doppio = premi({ ctrlKey: true, shiftKey: true, key: '@', code: 'Digit2' });
  for (const scritto of ['Ctrl-Shift-2', 'Ctrl Shift 2', 'ctrl - shift - 2', 'Control Maiusc 2']) {
    assert.ok(T.combacia(doppio, scritto), scritto);
    assert.equal(T.pezzoSconosciuto(scritto), null, scritto);
  }
  assert.ok(T.combacia(premi({ ctrlKey: true, key: 's', code: 'KeyS' }), 'Ctrl-S'));
  assert.ok(T.combacia(premi({ ctrlKey: true, key: '-', code: 'Minus' }), 'Ctrl--'));
  assert.ok(T.combacia(premi({ ctrlKey: true, key: 'ArrowDown', code: 'ArrowDown' }), 'Ctrl Freccia giù'));
  assert.ok(T.combacia(premi({ ctrlKey: true, key: 'ArrowDown', code: 'ArrowDown' }), 'Ctrl+Freccia giù'));
  assert.equal(T.pressioneScritta('b'), null);
  for (const solo of ['Ctrl', 'Ctrl+', 'Ctrl-', 'Ctrl+Shift', 'Cmd Shift', 'Shift']) assert.equal(T.soloModificatori(solo), true, solo);
  for (const no of ['Ctrl++', 'Ctrl--', 'Ctrl-S', 'Ctrl+Shift+1', 'b', '']) assert.equal(T.soloModificatori(no), false, no);
  assert.equal(T.etichetta('Ctrl-Shift-2', 'darwin'), 'Cmd+Shift+2');
});

test('su Mac i tasti presi prima della pagina sono quelli del Mac', () => {
  // «Incolla senza formato» del Mac è Cmd+Alt+Shift+V; Cmd+Shift+V lì non è di nessuno.
  assert.equal(T.riservato('Cmd+Alt+Shift+V', 'darwin'), true);
  assert.equal(T.riservato('Cmd+Shift+V', 'darwin'), false);
  assert.equal(T.riservato('Cmd+?', 'darwin'), true, 'Cmd+? apre il menu Aiuto');
  for (const accel of ['Cmd+Tab', 'Cmd+Shift+Tab', 'Cmd+Alt+Esc', 'Cmd+Shift+Q']) {
    assert.equal(T.delSistema(accel, 'darwin'), true, accel);
  }
  assert.equal(T.delSistema('Ctrl+Tab', 'win32'), false);
  for (const p of ['win32', 'linux']) assert.equal(T.delSistema('Ctrl+Alt+Canc', p), true, p);
});
