// Sentinella #893: la scorciatoia di un modulo dell'Editor si salva come tasto fisico (codice più modificatori),
// e ogni confronto (tasti di Filo, del sistema, dell'Editor, degli altri moduli) passa dal tasto che quella tastiera
// preme davvero. Le tastiere si simulano con la mappa che darebbe navigator.keyboard.getLayoutMap.
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

const lettere = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => [`Key${c}`, c.toLowerCase()]));
const cifre = Object.fromEntries([...'1234567890'].map((d) => [`Digit${d}`, d]));
const US = { ...lettere, ...cifre, Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: '\'', Backquote: '`', Comma: ',', Period: '.', Slash: '/' };
const IT = { ...lettere, ...cifre, Minus: '\'', Equal: 'ì', BracketLeft: 'è', BracketRight: '+', Backslash: 'ù',
  Semicolon: 'ò', Quote: 'à', Backquote: '\\', Comma: ',', Period: '.', Slash: '-' };
const FR = { ...lettere, KeyQ: 'a', KeyA: 'q', KeyW: 'z', KeyZ: 'w', KeyM: ',', Semicolon: 'm',
  Digit1: '&', Digit2: 'é', Digit3: '"', Digit4: '\'', Digit5: '(', Digit6: '-', Digit7: 'è', Digit8: '_', Digit9: 'ç', Digit0: 'à',
  Minus: ')', Equal: '=', Comma: ';', Period: ':', Slash: '!' };
const premi = (o) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });

test('Ctrl+! e Ctrl+Shift+1 sono lo stesso tasto, sulla tastiera americana e sull\'italiana', () => {
  for (const layout of [US, IT]) {
    const premuto = T.tastoFisicoDaEvento(premi({ ctrlKey: true, shiftKey: true, key: '!', code: 'Digit1' }), layout, 'win32');
    assert.equal(premuto.tasto, 'cs|Digit1');
    assert.equal(premuto.nome, 'Ctrl+Shift+1', 'il campo mostra il tasto, non il carattere');
    assert.equal(premuto.car, '!');
    assert.equal(T.tastoFisicoDaScritta('Ctrl+Shift+1', layout, 'win32').tasto, 'cs|Digit1');
    assert.equal(T.tastoFisicoDaScritta('ctrl maiusc 1', layout, 'win32').tasto, 'cs|Digit1');
    // «!» non ha un tasto suo: scritto non si converte, si preme.
    assert.equal(T.tastoFisicoDaScritta('Ctrl+!', layout, 'win32').rifiuto.tipo, 'senzaTastoProprio');
  }
  // Sulla francese «!» ha un tasto suo, e scritto si converte.
  assert.deepEqual(T.tastoFisicoDaScritta('Ctrl+!', FR, 'win32'), { tasto: 'c|Slash', nome: 'Ctrl+!' });
});

test('Windows, tastiera italiana: AltGr+ò (Ctrl+@) si salva come Ctrl+Alt+ò e combacia quando si ripreme', () => {
  const altGrO = premi({ ctrlKey: true, altKey: true, key: '@', code: 'Semicolon' });
  const r = T.tastoFisicoDaEvento(altGrO, IT, 'win32');
  assert.deepEqual(r, { tasto: 'ca|Semicolon', nome: 'Ctrl+Alt+ò', car: '@' });
  assert.equal(T.combaciaFisico(altGrO, r.tasto), true);
  assert.equal(T.combaciaFisico(premi({ ctrlKey: true, key: 'ò', code: 'Semicolon' }), r.tasto), false, 'senza Alt è un altro tasto');
  assert.equal(T.rifiutoFisico(r.tasto, IT, 'win32', { car: r.car }), null);
  assert.equal(T.tastoFisicoDaScritta('Ctrl+@', IT, 'win32').rifiuto.tipo, 'senzaTastoProprio');
  assert.equal(T.tastoFisicoDaScritta('Ctrl+Alt+ò', IT, 'win32').tasto, 'ca|Semicolon', 'il nome mostrato si riscrive');
  // L'AltGr da solo è un modificatore: si aspetta il tasto.
  assert.deepEqual(T.tastoFisicoDaEvento(premi({ ctrlKey: true, altKey: true, key: 'AltGraph', code: 'AltRight' }), IT, 'win32'), { attesa: true });
});

test('tastiera francese: Ctrl+6 è il tasto che scrive il meno, e chi controlla lo zoom lo vede così', () => {
  assert.deepEqual(T.tastoFisicoDaScritta('Ctrl+6', FR, 'win32'), { tasto: 'c|Digit6', nome: 'Ctrl+6' });
  assert.equal(T.tastoFisicoDaEvento(premi({ ctrlKey: true, key: '-', code: 'Digit6' }), FR, 'win32').tasto, 'c|Digit6');
  const p = T.pressioneFisica('c|Digit6', FR, 'win32');
  assert.equal(p.key, '-', 'lo zoom si riconosce dal carattere che esce');
  assert.equal(p.code, 'Digit6');
  // Su Mac lo zoom è della barra dei menu: è un tasto di Filo.
  assert.equal(T.rifiutoFisico('c|Digit6', FR, 'darwin').cosa, 'rimpicciolisce la pagina');
  // Le lettere vanno sul tasto che le scrive.
  assert.equal(T.tastoFisicoDaScritta('Ctrl+Shift+A', FR, 'win32').tasto, 'cs|KeyQ');
  assert.equal(T.nomeTastoFisico('cs|KeyQ', FR), 'Ctrl+Shift+A');
});

test('un tasto di Filo si confronta col tasto che lo produce su quella tastiera', () => {
  assert.equal(T.rifiutoFisico('c|KeyW', US, 'win32').cosa, 'chiude la scheda');
  // Sulla AZERTY la W sta dove la QWERTY ha la Z, e il main la riconosce dal carattere.
  assert.equal(T.rifiutoFisico('c|KeyZ', FR, 'win32').cosa, 'chiude la scheda');
  assert.equal(T.rifiutoFisico('c|KeyW', FR, 'win32'), null);
  // Il salto di scheda si riconosce dalla cifra della fila, anche dove scrive «&».
  assert.equal(T.rifiutoFisico('a|Digit1', FR, 'win32').cosa, 'porta alla scheda in quella posizione');
  assert.equal(T.rifiutoFisico('cs|Space', US, 'win32').cosa, 'apre il microfono delle chat');
  assert.equal(T.rifiutoFisico('a|F4', US, 'win32').tipo, 'sistema');
  assert.equal(T.rifiutoFisico('c|PrintScreen', US, 'linux').tipo, 'sistema');
  assert.equal(T.rifiutoFisico('cs|Digit1', US, 'win32'), null);
  // Su Mac il menu Aiuto è Cmd+?: premuto, il carattere uscito lo dice.
  assert.equal(T.rifiutoFisico('cs|Slash', US, 'darwin', { car: '?' }).cosa, 'apre il menu Aiuto');
});

test('con Shift una cifra o un simbolo scrivono un carattere che la tastiera non dice: scritto si preme', () => {
  assert.equal(T.tastoFisicoDaScritta('Ctrl+Shift+\\', US, 'win32').rifiuto.tipo, 'simbolo');
  assert.equal(T.tastoFisicoDaScritta('Ctrl+Shift+=', US, 'win32').rifiuto.tipo, 'simbolo');
  // Ctrl+Shift+0 non è lo zoom e Ctrl+Shift+\ non è la barra laterale: il carattere senza Shift non si presume.
  assert.equal(T.pressioneFisica('cs|Digit0', US, 'win32').key, '');
  assert.equal(T.pressioneFisica('cs|Backslash', US, 'win32').key, '');
  assert.equal(T.pressioneFisica('cs|Backslash', US, 'win32', '|').key, '|');
  assert.equal(T.pressioneFisica('cs|KeyS', US, 'win32').key, 's');
});

test('su Mac il nome è quello del Mac, e Control da solo non si salva come Cmd', () => {
  const r = T.tastoFisicoDaEvento(premi({ metaKey: true, shiftKey: true, key: '!', code: 'Digit1' }), US, 'darwin');
  assert.equal(r.tasto, 'cs|Digit1');
  assert.equal(T.etichettaScritta(r.nome, 'darwin'), T.etichetta('Ctrl+Shift+1', 'darwin'));
  assert.equal(T.etichettaScritta(r.nome, 'darwin'), 'Cmd+Shift+1');
  assert.equal(T.combaciaFisico(premi({ metaKey: true, shiftKey: true, key: '!', code: 'Digit1' }), r.tasto), true);
  assert.equal(T.combaciaFisico(premi({ ctrlKey: true, shiftKey: true, key: '!', code: 'Digit1' }), r.tasto), true, 'Ctrl vale Cmd');
  assert.equal(T.tastoFisicoDaEvento(premi({ ctrlKey: true, key: 'k', code: 'KeyK' }), US, 'darwin').rifiuto.tipo, 'macControl');
  assert.equal(T.tastoFisicoDaEvento(premi({ ctrlKey: true, metaKey: true, key: 'k', code: 'KeyK' }), US, 'darwin').tasto, 'cm|KeyK');
  assert.equal(T.pressioneFisica('c|KeyK', US, 'darwin').metaKey, true);
  // Il tasto Windows (Super su Linux) se lo prende il sistema.
  assert.equal(T.tastoFisicoDaEvento(premi({ metaKey: true, key: 'k', code: 'KeyK' }), US, 'win32').rifiuto.tipo, 'win');
  assert.equal(T.tastoFisicoDaEvento(premi({ metaKey: true, key: 'k', code: 'KeyK' }), US, 'linux').rifiuto.tipo, 'win');
});

test('senza sapere com\'è fatta la tastiera lettere e simboli restano testo; cifre e tasti con nome no', () => {
  assert.equal(T.tastoFisicoDaScritta('Ctrl+Shift+K', null, 'win32'), null);
  assert.equal(T.tastoFisicoDaScritta('Ctrl+-', null, 'win32'), null);
  assert.equal(T.tastoFisicoDaScritta('Ctrl+Shift+2', null, 'win32').tasto, 'cs|Digit2');
  assert.equal(T.tastoFisicoDaScritta('Ctrl+Spazio', null, 'win32').tasto, 'c|Space');
  assert.equal(T.tastoFisicoDaScritta('Ctrl+Su', null, 'win32').tasto, 'c|ArrowUp');
  assert.equal(T.tastoFisicoDaScritta('Alt+F5', null, 'win32').tasto, 'a|F5');
  assert.equal(T.tastoFisicoDaScritta('b', US, 'win32').rifiuto.tipo, 'senzaModificatore');
  assert.equal(T.tastoFisicoDaScritta('Ctrl+Pippo+2', US, 'win32').rifiuto.tipo, 'modificatore');
  // Il nome di un tasto si rilegge com'è: «Ctrl+Spazio», «Ctrl+=» (il tasto uguale, non il più).
  assert.equal(T.nomeTastoFisico('c|Space', US), 'Ctrl+Spazio');
  assert.equal(T.tastoFisicoDaScritta('Ctrl+=', US, 'win32').tasto, 'c|Equal');
  assert.equal(T.tastoFisicoDaScritta('Ctrl+Plus', IT, 'win32').tasto, 'c|BracketRight');
});

test('le cifre del tastierino valgono la fila in alto, e un tasto salvato male non si legge', () => {
  assert.equal(T.tastoFisicoDaEvento(premi({ ctrlKey: true, shiftKey: true, key: 'End', code: 'Numpad1' }), US, 'win32').tasto, 'cs|Digit1');
  assert.equal(T.combaciaFisico(premi({ ctrlKey: true, shiftKey: true, key: '1', code: 'Numpad1' }), 'cs|Digit1'), true);
  for (const male of ['', '|Digit1', 's|KeyA', 'm|KeyA', 'c|Pippo', 'c|Digit1|x', { code: 'Digit1' }]) {
    assert.equal(T.tastoValido(male), false, JSON.stringify(male));
    assert.equal(T.combaciaFisico(premi({ ctrlKey: true, key: '1', code: 'Digit1' }), male), false);
  }
  assert.equal(T.tastoFisicoDaEvento(premi({ ctrlKey: true, key: 'AudioVolumeUp', code: 'AudioVolumeUp' }), US, 'win32').rifiuto.tipo, 'tasto');
});

test('l\'Editor fa partire i moduli dal tasto fisico e li registra premendo', () => {
  const src = readFileSync(join(ROOT, 'src', 'pages', 'editor', 'editor.js'), 'utf8');
  assert.match(src, /TASTI\.combaciaFisico\(/, 'alla pressione si confronta il tasto fisico');
  assert.match(src, /TASTI\.tastoFisicoDaEvento\(/, 'il campo registra il tasto premuto');
  assert.match(src, /TASTI\.rifiutoFisico\(/, 'i tasti di Filo e del sistema si confrontano col tasto fisico');
  assert.match(src, /MSG\.REGISTRA_TASTI/, 'mentre registra, il main lascia arrivare anche i tasti che si prende');
});
