// Su un sito i riquadri di Filo nascono nello strato sopra la scheda (#1509.1), mai nel documento del sito: ogni modulo
// che apre un riquadro chiede prima lo strato, e lo strato sa aprire ogni tipo che gli si chiede.
// Regola: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);

// Il modulo, la funzione che apre e il tipo che chiede allo strato.
const APERTURE = [
  ['src/content/feedback.js', 'function open(', 'feedback'],
  ['src/content/redteamAttack.js', 'function open(', 'redteam'],
  ['src/content/editBox.js', 'function openEditBox(', 'modifica'],
  ['src/content/popup.js', 'function openStreaming(', 'risposta'],
  ['src/content/sidebar.js', 'function open(', 'aiuto'],
];

test('ogni riquadro, aperto su un sito, lo chiede prima allo strato', () => {
  for (const [file, funzione, tipo] of APERTURE) {
    const src = leggi(file);
    const inizio = src.indexOf(funzione);
    assert.ok(inizio >= 0, `${file}: manca ${funzione}`);
    const corpo = src.slice(inizio, src.indexOf('\n  }\n', inizio));
    assert.match(corpo, new RegExp(`SN_RIQUADRI_SOPRA\\?\\.apri\\('${tipo}'`), `${file}: ${funzione} non passa dallo strato`);
    assert.doesNotMatch(corpo, /createElement|appendChild/, `${file}: ${funzione} disegna prima di chiedere lo strato`);
  }
});

test('lo strato apre ogni tipo che il main accetta, e il main accetta solo quelli', () => {
  const { TIPI } = require(join(ROOT, 'src', 'main', 'stratoDeiRiquadri.js'));
  assert.deepEqual([...TIPI].sort(), APERTURE.map((a) => a[2]).sort());
  const strato = leggi('src', 'content', 'stratoRiquadri.js');
  for (const tipo of TIPI) assert.match(strato, new RegExp(`d\\.tipo === '${tipo}'`), `lo strato non apre «${tipo}»`);
});

test('l\'ancora di una risposta passa dai px della pagina a quelli della vista', () => {
  const { ancoraNellaVista } = require(join(ROOT, 'src', 'main', 'stratoDeiRiquadri.js'));
  assert.deepEqual(ancoraNellaVista({ x: 100, y: 50, top: 40, bottom: 60 }, 1.5), { x: 150, y: 75, top: 60, bottom: 90 });
  assert.deepEqual(ancoraNellaVista({ x: 10, y: 'boh' }, 1), { x: 10 });
  assert.equal(ancoraNellaVista(null, 1), null);
  assert.equal(ancoraNellaVista({}, 2), null);
});

// Mentre lo strato nasce si trattengono per lui solo i tasti che scrivono (#1509.3): una scorciatoia trattenuta e poi
// rigiocata nello strato agirebbe due volte.
test('mentre lo strato nasce si trattengono i tasti che scrivono, mai le scorciatoie', () => {
  const { scrive } = require(join(ROOT, 'src', 'main', 'stratoDeiRiquadri.js'));
  const k = (key, m = {}) => ({ type: 'keyDown', key, ...m });
  for (const p of ['win32', 'linux', 'darwin']) {
    for (const t of [k('a'), k('A', { shift: true }), k(' '), k('è'), k('Backspace'), k('Enter'), { type: 'keyUp', key: 'a' }]) {
      assert.equal(scrive(t, p), true, `${p}: ${JSON.stringify(t)}`);
    }
    for (const t of [k('w', { control: true }), k('l', { meta: true }), k('Escape'), k('F5'), k('Tab'), k('Shift'), k('a', { isComposing: true }), { type: 'char', key: 'a' }]) {
      assert.equal(scrive(t, p), false, `${p}: ${JSON.stringify(t)}`);
    }
    // AltGr arriva come Ctrl+Alt: scrive i simboli, mentre Ctrl+Alt+lettera resta una scorciatoia.
    assert.equal(scrive(k('@', { control: true, alt: true }), p), true);
    assert.equal(scrive(k('h', { control: true, alt: true }), p), false);
  }
  // Su Mac Opzione scrive; altrove Alt+lettera è una scorciatoia di Filo.
  assert.equal(scrive(k('å', { alt: true }), 'darwin'), true);
  assert.equal(scrive(k('h', { alt: true }), 'linux'), false);
  assert.equal(scrive(k('h', { alt: true }), 'win32'), false);
});

// L'Aiuto nello strato lavora sulla pagina sotto (#1509.3): chiede solo quello che il main lascia passare, e la pagina
// sa rispondere a tutto quello che passa.
test('l\'Aiuto nello strato chiede alla pagina solo operazioni che il main conosce e la pagina serve', () => {
  const { OP_PAGINA } = require(join(ROOT, 'src', 'main', 'stratoDeiRiquadri.js'));
  const ops = Object.keys(OP_PAGINA).sort();
  const aiuto = leggi('src', 'content', 'sidebar.js');
  const chieste = [...aiuto.matchAll(/chiediSotto\('([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(chieste.length >= ops.length, 'l\'Aiuto chiede alla pagina con chiediSotto');
  for (const op of chieste) assert.ok(ops.includes(op), `il main non lascia passare «${op}»`);
  const pagina = leggi('src', 'content', 'aiutoPagina.js');
  for (const op of ops) assert.match(pagina, new RegExp(`m\\.op === '${op}'`), `la pagina non serve «${op}»`);
  // Lo stato del pannello lo manda solo lo strato, e la risposta solo il frame principale della pagina.
  const handler = leggi('src', 'main', 'services', 'handlers', 'riquadri.js');
  assert.match(handler, /on\(MSG\.AIUTO_ALLA_PAGINA[\s\S]{0,120}if \(!sender \|\| !sender\.strato\) return/);
  const strato = leggi('src', 'main', 'stratoDeiRiquadri.js');
  assert.match(strato, /esitoDallaPagina\(sender, d\) \{\s*const s = sender && !sender\.strato \?/);
  assert.match(strato, /comandoAiuto\(sender, d\) \{\s*const s = sender && !sender\.strato \?/);
});
