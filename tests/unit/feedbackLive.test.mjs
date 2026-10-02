// Unit test per src/shared/feedbackLive.js — l'aggiornamento continuo della
// dashboard di gestione: confronto fra le versioni lette da Firestore e la
// lista in mano (diffVersions) e fusione dei documenti riletti (applyChanges).
// Logica pura, niente rete: gira via `npm run test:unit`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackLive.js'));
const LIVE = globalThis.SN_FEEDBACK_LIVE;

test('espone un ritmo di aggiornamento ragionevole (secondi, non millisecondi)', () => {
  assert.equal(typeof LIVE.POLL_MS, 'number');
  assert.ok(LIVE.POLL_MS >= 10 * 1000 && LIVE.POLL_MS <= 5 * 60 * 1000);
});

test('diffVersions: riconosce cambiati, nuovi e spariti', () => {
  const local = [
    { _id: 'a', _updateTime: 't1' },
    { _id: 'b', _updateTime: 't1' },
    { _id: 'c', _updateTime: 't1' },
  ];
  const remote = [
    { _id: 'd', _updateTime: 't5' }, // nuovo
    { _id: 'a', _updateTime: 't2' }, // riscritto
    { _id: 'b', _updateTime: 't1' }, // uguale
    // 'c' non c'è più
  ];
  const d = LIVE.diffVersions(local, remote);
  assert.deepEqual(d.changed, ['a']);
  assert.deepEqual(d.added, ['d']);
  assert.deepEqual(d.removed, ['c']);
});

test('diffVersions: senza versione locale il documento va riletto', () => {
  const d = LIVE.diffVersions([{ _id: 'a' }], [{ _id: 'a', _updateTime: 't1' }]);
  assert.deepEqual(d.changed, ['a']);
});

// La dashboard tiene TUTTI i feedback, ma ogni minuto rilegge solo la finestra
// dei più recenti: chi è più vecchio del bordo non è sparito, è fuori.
test('diffVersions: con la finestra piena i più vecchi del bordo restano', () => {
  const local = [
    { _id: 'nuovo', _updateTime: 't1', createdAt: '2026-10-01T10:00:00Z' },
    { _id: 'bordo', _updateTime: 't1', createdAt: '2026-09-30T10:00:00Z' },
    { _id: 'cancellato', _updateTime: 't1', createdAt: '2026-09-30T12:00:00Z' },
    { _id: 'f597', _updateTime: 't1', createdAt: '2026-09-01T10:00:00Z' },
  ];
  const remote = [
    { _id: 'nuovo', _updateTime: 't2', createdAt: '2026-10-01T10:00:00Z' },
    { _id: 'bordo', _updateTime: 't1', createdAt: '2026-09-30T10:00:00Z' },
  ];
  const d = LIVE.diffVersions(local, remote, { finestra: 2 });
  assert.deepEqual(d.changed, ['nuovo']);
  assert.deepEqual(d.removed, ['cancellato']);
  // Senza finestra (giro lungo) lo stesso assente è davvero sparito.
  assert.deepEqual(LIVE.diffVersions(local, remote).removed, ['cancellato', 'f597']);
});

test('diffVersions: finestra non piena = tutto, e lettura parziale non toglie niente', () => {
  const local = [
    { _id: 'a', _updateTime: 't1', createdAt: '2026-10-01T10:00:00Z' },
    { _id: 'vecchio', _updateTime: 't1', createdAt: '2026-01-01T10:00:00Z' },
  ];
  const remote = [{ _id: 'a', _updateTime: 't1', createdAt: '2026-10-01T10:00:00Z' }];
  assert.deepEqual(LIVE.diffVersions(local, remote, { finestra: 500 }).removed, ['vecchio']);
  assert.deepEqual(LIVE.diffVersions(local, remote, { parziale: true }).removed, []);
  // Finestra piena ma senza date: non si sa dove finisce, non si toglie niente.
  const senzaDate = LIVE.diffVersions([{ _id: 'x', _updateTime: 't1' }], [{ _id: 'y', _updateTime: 't1' }], { finestra: 1 });
  assert.deepEqual(senzaDate.removed, []);
  assert.deepEqual(senzaDate.added, ['y']);
});

test('ordina: dal più recente, su una copia', () => {
  const righe = [
    { _id: 'b', createdAt: '2026-01-01T00:00:00Z' },
    { _id: 'a', createdAt: '2026-10-01T00:00:00Z' },
  ];
  assert.deepEqual(LIVE.ordina(righe).map((r) => r._id), ['a', 'b']);
  assert.deepEqual(righe.map((r) => r._id), ['b', 'a']);
});

test('diffVersions: niente di nuovo → tre liste vuote', () => {
  const local = [{ _id: 'a', _updateTime: 't1' }];
  const d = LIVE.diffVersions(local, [{ _id: 'a', _updateTime: 't1' }]);
  assert.deepEqual(d, { changed: [], added: [], removed: [] });
});

test('applyChanges: sostituisce, aggiunge, toglie e riordina dal più recente', () => {
  const list = [
    { _id: 'a', createdAt: '2026-09-03T10:00:00Z', name: 'vecchio A' },
    { _id: 'b', createdAt: '2026-09-02T10:00:00Z', name: 'B' },
    { _id: 'c', createdAt: '2026-09-01T10:00:00Z', name: 'C' },
  ];
  const out = LIVE.applyChanges(list, {
    fresh: [
      { _id: 'a', createdAt: '2026-09-03T10:00:00Z', name: 'nuovo A' },
      { _id: 'd', createdAt: '2026-09-04T10:00:00Z', name: 'D' },
    ],
    removed: ['c'],
  });
  assert.deepEqual(out.map((f) => f._id), ['d', 'a', 'b']);
  assert.equal(out.find((f) => f._id === 'a').name, 'nuovo A');
  // La lista d'ingresso non viene toccata.
  assert.equal(list.length, 3);
  assert.equal(list[0].name, 'vecchio A');
});

test('applyChanges: senza cambiamenti restituisce gli stessi documenti', () => {
  const a = { _id: 'a', createdAt: '2026-09-03T10:00:00Z' };
  const out = LIVE.applyChanges([a], {});
  assert.equal(out.length, 1);
  assert.equal(out[0], a);
});
