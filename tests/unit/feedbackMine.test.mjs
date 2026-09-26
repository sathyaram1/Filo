// Il registro dei feedback mandati da questa installazione (#678): quando si
// torna a chiedere al server, e quando invece si sta zitti.
//
// Senza queste regole la home chiedeva TUTTE le schede pubbliche a ogni
// apertura, per ogni utente: una lettura per scheda esistente, per una
// risposta che cambia una volta ogni mai.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../src/shared/feedbackMine.js');

test('un identificativo nuovo azzera l\'attesa: chi ha appena segnalato non aspetta', () => {
  const ora = 10_000_000_000;
  const prima = { ids: ['a'], checkedAt: ora };
  assert.equal(M.scaduto(prima, ora + 1000), false);
  const dopo = M.conId(prima, 'b');
  assert.deepEqual(dopo.ids, ['a', 'b']);
  assert.equal(dopo.checkedAt, 0);
  assert.equal(M.scaduto(dopo, ora + 1000), true);
});

test('un identificativo già noto non riapre l\'attesa', () => {
  const ora = 10_000_000_000;
  const prima = { ids: ['a'], checkedAt: ora };
  const dopo = M.conId(prima, 'a');
  assert.deepEqual(dopo.ids, ['a']);
  assert.equal(dopo.checkedAt, ora);
});

test('fra un controllo e l\'altro passano ore, non aperture di pagina', () => {
  const ora = 10_000_000_000;
  const stato = { ids: ['a'], checkedAt: ora };
  assert.equal(M.scaduto(stato, ora + 1000), false);
  assert.equal(M.scaduto(stato, ora + M.INTERVALLO_MS - 1), false);
  assert.equal(M.scaduto(stato, ora + M.INTERVALLO_MS), true);
});

test('un\'installazione senza eredità non legge mai tutte le schede', () => {
  const ora = 10_000_000_000;
  assert.equal(M.toccaScansione({ ids: [], checkedAt: 0 }, ora), false);
  assert.equal(M.toccaScansione(M.vuoto(), ora), false);
});

test('l\'eredità scansiona una volta al giorno e si spegne da sola', () => {
  const ora = 10_000_000_000;
  const stato = { ids: [], ereditaFinoA: ora + 5 * 24 * 3600_000, ereditaUltimoGiro: 0 };
  assert.equal(M.toccaScansione(stato, ora), true);

  const dopoUnGiro = { ...stato, ereditaUltimoGiro: ora };
  assert.equal(M.toccaScansione(dopoUnGiro, ora + 3600_000), false);
  assert.equal(M.toccaScansione(dopoUnGiro, ora + M.EREDITA_GIRO_MS), true);

  // Finita la finestra non si rilegge più niente, nemmeno passato un giorno.
  assert.equal(M.toccaScansione(dopoUnGiro, ora + 6 * 24 * 3600_000), false);
});

test('il registro regge quello che trova su disco senza rompersi', () => {
  assert.deepEqual(M.normalizza(null).ids, []);
  assert.deepEqual(M.normalizza('rotto').ids, []);
  assert.deepEqual(M.normalizza({ ids: ['a', 'a', '', null, 'b'] }).ids, ['a', 'b']);
});

test('il tetto degli identificativi butta i PIÙ VECCHI, non i nuovi', () => {
  const troppi = Array.from({ length: M.MAX_ID + 10 }, (_, i) => `id-${i}`);
  const s = M.normalizza({ ids: troppi });
  assert.equal(s.ids.length, M.MAX_ID);
  assert.equal(s.ids[s.ids.length - 1], `id-${M.MAX_ID + 9}`);
  assert.equal(s.ids.includes('id-0'), false);
});
