// Unit test per il gate DB3 ("In produzione") della dashboard di gestione:
// un fix chiuso (`done`/`verified`) finisce in "Risolti" SOLO se davvero uscito
// in una versione rilasciata; altrimenti resta in "In coda".
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

// ── cmpVersion ──────────────────────────────────────────────────────────────

test('cmpVersion: semver leggero, 0.2.9 < 0.2.10', () => {
  assert.equal(MR.cmpVersion('0.2.9', '0.2.10'), -1);
  assert.equal(MR.cmpVersion('0.2.10', '0.2.9'), 1);
  assert.equal(MR.cmpVersion('0.2.74', '0.2.74'), 0);
  assert.equal(MR.cmpVersion('1.0.0', '0.9.9'), 1);
});

// ── isShipped ───────────────────────────────────────────────────────────────

test('isShipped: senza releasedVersion → sempre spedito (gate inattivo)', () => {
  assert.equal(MR.isShipped({ resolvedInVersion: '9.9.9' }, undefined), true);
  assert.equal(MR.isShipped({ resolvedInVersion: '9.9.9' }, ''), true);
});

test('isShipped: done storico senza resolvedInVersion → spedito', () => {
  assert.equal(MR.isShipped({ status: 'done' }, '0.2.74'), true);
});

test('isShipped: resolvedInVersion ≤ rilasciata → spedito', () => {
  assert.equal(MR.isShipped({ resolvedInVersion: '0.2.70' }, '0.2.74'), true);
  assert.equal(MR.isShipped({ resolvedInVersion: '0.2.74' }, '0.2.74'), true);
});

test('isShipped: resolvedInVersion futura → NON spedito', () => {
  assert.equal(MR.isShipped({ resolvedInVersion: '0.2.75' }, '0.2.74'), false);
  assert.equal(MR.isShipped({ resolvedInVersion: '0.3.0' }, '0.2.74'), false);
});

// ── manageTabFor: gate "Risolti" ─────────────────────────────────────────────

test('manageTabFor: done con versione già rilasciata → Risolti', () => {
  const fb = { status: 'done', resolvedInVersion: '0.2.70' };
  assert.equal(MR.manageTabFor(fb, { releasedVersion: '0.2.74' }), 'resolved');
});

test('manageTabFor: done con versione FUTURA → resta In coda (queue)', () => {
  const fb = { status: 'done', resolvedInVersion: '0.2.75' };
  assert.equal(MR.manageTabFor(fb, { releasedVersion: '0.2.74' }), 'queue');
});

test('manageTabFor: verified non ancora spedito → In coda', () => {
  const fb = { status: 'verified', resolvedInVersion: '0.2.99' };
  assert.equal(MR.manageTabFor(fb, { releasedVersion: '0.2.74' }), 'queue');
});

test('manageTabFor: done storico senza versione → Risolti', () => {
  const fb = { status: 'done' };
  assert.equal(MR.manageTabFor(fb, { releasedVersion: '0.2.74' }), 'resolved');
});

test('manageTabFor: senza opts il comportamento storico è intatto (done→Risolti)', () => {
  assert.equal(MR.manageTabFor({ status: 'done', resolvedInVersion: '99.0.0' }), 'resolved');
});

// ── listForManageTab: smistamento reale tra le due tab ───────────────────────

test('listForManageTab: spedito in Risolti, non-spedito in In coda', () => {
  const shipped   = { id: 'a', status: 'done', resolvedInVersion: '0.2.70', createdAt: '2026-06-20' };
  const pending   = { id: 'b', status: 'done', resolvedInVersion: '0.2.90', createdAt: '2026-06-21' };
  // todo APPROVATO (aligned+automatica): senza approvazione finirebbe nei Ricevuti.
  const todo      = { id: 'c', status: 'todo', pipeline: { action: 'candidate_change' }, createdAt: '2026-06-22' };
  const all = [shipped, pending, todo];
  const opts = { releasedVersion: '0.2.74' };

  const resolved = MR.listForManageTab(all, 'resolved', opts).map((f) => f.id);
  const queue    = MR.listForManageTab(all, 'queue', opts).map((f) => f.id);

  assert.deepEqual(resolved, ['a']);
  assert.equal(queue.includes('b'), true, 'il done non spedito è in coda');
  assert.equal(queue.includes('c'), true, 'il todo è in coda');
  assert.equal(queue.includes('a'), false, 'lo spedito non è in coda');
});
