// Unit test per la logica di classificazione e ordinamento della sezione
// "Revisione" della dashboard di gestione (src/shared/manageReview.js).
// Gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'manageReview.js'));

const MR = globalThis.SN_MANAGE_REVIEW;

// ── classifyBlock ─────────────────────────────────────────────────────────

test('espone classifyBlock e sortReview', () => {
  assert.equal(typeof MR.classifyBlock, 'function');
  assert.equal(typeof MR.sortReview, 'function');
});

test('classifyBlock: nessuna pipeline → null', () => {
  assert.equal(MR.classifyBlock({}), null);
  assert.equal(MR.classifyBlock({ pipeline: null }), null);
  assert.equal(MR.classifyBlock({ pipeline: undefined }), null);
});

test('classifyBlock: aligned / nessun motivo → null', () => {
  assert.equal(MR.classifyBlock({ pipeline: { l2Class: 'aligned', action: 'candidate_change' } }), null);
  assert.equal(MR.classifyBlock({ pipeline: { stage: 'L1' } }), null);
});

test('classifyBlock: reason=attack via action block_attack', () => {
  const r = MR.classifyBlock({ pipeline: { action: 'block_attack' } });
  assert.equal(r.reason, 'attack');
  assert.equal(r.severity, 3);
});

test('classifyBlock: reason=attack via l1Category=dangerous', () => {
  const r = MR.classifyBlock({ pipeline: { l1Category: 'dangerous' } });
  assert.equal(r.reason, 'attack');
});

test('classifyBlock: reason=attack via l2Class=attack', () => {
  const r = MR.classifyBlock({ pipeline: { l2Class: 'attack' } });
  assert.equal(r.reason, 'attack');
});

test('classifyBlock: reason=spam via action block_spam', () => {
  const r = MR.classifyBlock({ pipeline: { action: 'block_spam' } });
  assert.equal(r.reason, 'spam');
  assert.equal(r.severity, 2);
});

test('classifyBlock: reason=spam via l1Category=spam', () => {
  const r = MR.classifyBlock({ pipeline: { l1Category: 'spam' } });
  assert.equal(r.reason, 'spam');
});

test('classifyBlock: reason=spam via l2Class=spam', () => {
  const r = MR.classifyBlock({ pipeline: { l2Class: 'spam' } });
  assert.equal(r.reason, 'spam');
});

test('classifyBlock: reason=design via l2Class=design', () => {
  const r = MR.classifyBlock({ pipeline: { l2Class: 'design' } });
  assert.equal(r.reason, 'design');
  assert.equal(r.severity, 1);
});

test('classifyBlock: attack vince su spam se entrambi presenti', () => {
  const r = MR.classifyBlock({ pipeline: { action: 'block_attack', l1Category: 'spam' } });
  assert.equal(r.reason, 'attack');
});

test('classifyBlock: spam vince su design', () => {
  const r = MR.classifyBlock({ pipeline: { l2Class: 'spam', action: 'block_spam' } });
  assert.equal(r.reason, 'spam');
  assert.notEqual(r.reason, 'design');
});

// ── sortReview ─────────────────────────────────────────────────────────────

function fb(id, pipeline, createdAt) {
  return { _id: id, pipeline, createdAt };
}

test('sortReview: severità DESC (attack > spam > design)', () => {
  const input = [
    fb('d', { l2Class: 'design' },         '2026-01-01'),
    fb('a', { action: 'block_attack' },     '2026-01-02'),
    fb('s', { l1Category: 'spam' },         '2026-01-03'),
  ];
  const out = MR.sortReview(input);
  assert.equal(out[0]._id, 'a');
  assert.equal(out[1]._id, 's');
  assert.equal(out[2]._id, 'd');
});

test('sortReview: a parità di severità, più recenti prima', () => {
  const input = [
    fb('old',  { action: 'block_spam' }, '2026-01-01'),
    fb('new',  { action: 'block_spam' }, '2026-06-01'),
    fb('mid',  { action: 'block_spam' }, '2026-03-01'),
  ];
  const out = MR.sortReview(input);
  assert.equal(out[0]._id, 'new');
  assert.equal(out[1]._id, 'mid');
  assert.equal(out[2]._id, 'old');
});

test('sortReview: non muta l'array originale', () => {
  const input = [
    fb('a', { action: 'block_attack' }, '2026-01-02'),
    fb('s', { action: 'block_spam' },   '2026-01-01'),
  ];
  const copy = input.slice();
  MR.sortReview(input);
  assert.deepEqual(input, copy);
});

test('sortReview: lista vuota → array vuoto', () => {
  assert.deepEqual(MR.sortReview([]), []);
});
