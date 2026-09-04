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
