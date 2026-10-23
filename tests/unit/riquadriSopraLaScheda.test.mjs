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
