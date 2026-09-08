// #520 giro 2 — «da quanto sto aspettando» è la stessa domanda nella chat dei
// mazzi e in quella della home, e deve avere la stessa risposta. La regola vive
// in un posto solo: qui si controlla che dica quello che promette.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'attesa.js'));
const A = globalThis.SN_ATTESA;

test('sotto la soglia il cronometro tace: una risposta rapida non lo merita', () => {
  const t0 = 1_000_000;
  assert.equal(A.etichetta(t0, t0), '');
  assert.equal(A.etichetta(t0, t0 + 4999), '');
  assert.equal(A.etichetta(t0, t0 + 5000), '5s');
});

test('i secondi, poi minuti e secondi: «137s» non si legge', () => {
  const t0 = 1_000_000;
  assert.equal(A.etichetta(t0, t0 + 12_000), '12s');
  assert.equal(A.etichetta(t0, t0 + 89_000), '89s');
  assert.equal(A.etichetta(t0, t0 + 90_000), '1m 30s');
  assert.equal(A.etichetta(t0, t0 + 125_000), '2m 05s');
  assert.equal(A.etichetta(t0, t0 + 3_600_000), '60m 00s');
});

test('senza un istante di partenza non si inventa un numero', () => {
  assert.equal(A.etichetta(0, 1_000_000), '');
  assert.equal(A.etichetta(null, 1_000_000), '');
  assert.equal(A.etichetta(undefined, 1_000_000), '');
  assert.equal(A.etichetta('domani', 1_000_000), '');
});

test('l\'attesa fermata dall\'utente non si racconta come un guasto', () => {
  assert.match(A.TESTO_INTERROTTA, /interrott/i);
  assert.doesNotMatch(A.TESTO_INTERROTTA, /errore|guasto|non ha funzionato/i);
});

test('la chat della home e quella dei mazzi chiedono l\'etichetta allo stesso posto', async () => {
  const { readFileSync } = await import('node:fs');
  const SRC = join(__dirname, '..', '..', 'src');
  for (const p of [
    join(SRC, 'pages', 'decks', 'decks.js'),
    join(SRC, 'pages', 'dashboard', 'dashboard.js'),
  ]) {
    const testo = readFileSync(p, 'utf8');
    assert.ok(/SN_ATTESA/.test(testo), `${p}: il cronometro dell'attesa non passa da SN_ATTESA`);
  }
  // E la pagina lo carica davvero, altrimenti a schermo non compare niente.
  for (const p of [
    join(SRC, 'pages', 'decks', 'decks.html'),
    join(SRC, 'pages', 'dashboard', 'dashboard.html'),
  ]) {
    assert.ok(readFileSync(p, 'utf8').includes('shared/attesa.js'), `${p}: manca lo script`);
  }
});
