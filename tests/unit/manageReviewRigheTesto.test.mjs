// Il testo di un livello (segnalazione del rombo, nota del pentagono) spezzato
// in titoli, voci d'elenco e paragrafi: è quello che la dashboard disegna
// senza HTML. Nato dalla verifica del ramo claude/livelli (giro 1): la
// segnalazione si leggeva col markdown grezzo, cancelletti compresi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackStatus.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'manageReview.js'));

const MR = globalThis.SN_MANAGE_REVIEW;

test('righeTesto: i tre titoli della segnalazione e le voci a trattino si riconoscono', () => {
  const testo = '## Problema\nDue strade.\n\n## Scelte\n- A: veloce\n- B: costa di più\n## Cosa ho fatto nel frattempo\nA.';
  const r = MR.righeTesto(testo);
  assert.deepEqual(r, [
    { tipo: 'titolo', livello: 2, testo: 'Problema' },
    { tipo: 'testo', testo: 'Due strade.' },
    { tipo: 'titolo', livello: 2, testo: 'Scelte' },
    { tipo: 'voce', testo: 'A: veloce' },
    { tipo: 'voce', testo: 'B: costa di più' },
    { tipo: 'titolo', livello: 2, testo: 'Cosa ho fatto nel frattempo' },
    { tipo: 'testo', testo: 'A.' },
  ]);
});

test('righeTesto: le righe di seguito fanno un paragrafo, la riga vuota lo chiude; CRLF vale come LF', () => {
  const r = MR.righeTesto('prima\r\nseconda\r\n\r\nterza');
  assert.deepEqual(r, [
    { tipo: 'testo', testo: 'prima\nseconda' },
    { tipo: 'testo', testo: 'terza' },
  ]);
});

test('righeTesto: un cancelletto senza spazio, o in mezzo alla frase, non è un titolo; un trattino senza testo non è una voce', () => {
  const r = MR.righeTesto('#hashtag\nvedi ## Problema qui\n-\n1) uno\n* due');
  assert.deepEqual(r, [
    { tipo: 'testo', testo: '#hashtag\nvedi ## Problema qui\n-' },
    { tipo: 'voce', testo: 'uno' },
    { tipo: 'voce', testo: 'due' },
  ]);
});

test('righeTesto: HTML resta testo, e il vuoto dà zero righe', () => {
  const r = MR.righeTesto('## <b>x</b>\n- <img src=x>');
  assert.deepEqual(r, [
    { tipo: 'titolo', livello: 2, testo: '<b>x</b>' },
    { tipo: 'voce', testo: '<img src=x>' },
  ]);
  assert.deepEqual(MR.righeTesto(''), []);
  assert.deepEqual(MR.righeTesto(null), []);
  assert.deepEqual(MR.righeTesto('   \n\n  '), []);
});
