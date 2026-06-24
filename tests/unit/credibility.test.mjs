// Unit test per il substrato credibilità per utente (DC5,
// src/shared/userCredibility.js): getCredibility / freshEntry / makeVoteRecord /
// recordVoteOutcome / recordVoteCast / canEarnFromVote.
//
// Logica pura: gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'userCredibility.js'));

const UC = globalThis.SN_USER_CREDIBILITY;

// ── API esposta ─────────────────────────────────────────────────────────────

test('SN_USER_CREDIBILITY si registra su globalThis con l\'API attesa', () => {
  assert.ok(UC, 'SN_USER_CREDIBILITY deve essere presente su globalThis');
  for (const fn of ['getCredibility', 'freshEntry', 'makeVoteRecord',
                    'recordVoteOutcome', 'recordVoteCast', 'canEarnFromVote']) {
    assert.equal(typeof UC[fn], 'function', `manca la funzione ${fn}`);
  }
  assert.equal(typeof UC.DEFAULT_CREDIBILITY, 'number', 'DEFAULT_CREDIBILITY deve essere un numero');
  assert.equal(UC.DEFAULT_CREDIBILITY, 1, 'DEFAULT_CREDIBILITY deve essere 1');
});

// ── getCredibility ──────────────────────────────────────────────────────────

test('getCredibility: default = 1 se uid non presente nello store', () => {
  const store = {};
  assert.equal(UC.getCredibility('uid-ignoto', store), 1);
});

test('getCredibility: default = 1 se store è null/undefined', () => {
  assert.equal(UC.getCredibility('uid', null), 1);
  assert.equal(UC.getCredibility('uid', undefined), 1);
});

test('getCredibility: default = 1 se uid è falsy', () => {
  const store = { '': { credibility: 5 } };
  assert.equal(UC.getCredibility('', store), 1);
  assert.equal(UC.getCredibility(null, store), 1);
});

test('getCredibility: legge il valore reale dallo store', () => {
  const store = { 'uid-a': { credibility: 2.5 } };
  assert.equal(UC.getCredibility('uid-a', store), 2.5);
});

test('getCredibility: valore non numerico nell\'entry → default 1', () => {
  const store = { 'uid-x': { credibility: 'nope' } };
  assert.equal(UC.getCredibility('uid-x', store), 1);
});

test('getCredibility: valore negativo nell\'entry → default 1', () => {
  const store = { 'uid-neg': { credibility: -3 } };
  assert.equal(UC.getCredibility('uid-neg', store), 1);
});

// ── freshEntry ──────────────────────────────────────────────────────────────

test('freshEntry: crea entry con credibility = DEFAULT (1)', () => {
  const e = UC.freshEntry('uid-1');
  assert.equal(e.credibility, 1);
  assert.equal(e.uid, 'uid-1');
  assert.equal(e.voteCount, 0);
  assert.equal(e.matchCount, 0);
  assert.equal(e.missCount, 0);
  assert.equal(e.lastVoteAt, null);
  assert.ok(Array.isArray(e.outcomes));
  assert.equal(e.outcomes.length, 0);
});

test('freshEntry: accetta firstSeenAt custom', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const e = UC.freshEntry('uid-2', { firstSeenAt: at });
  assert.equal(e.firstSeenAt, at);
});

// ── makeVoteRecord ──────────────────────────────────────────────────────────

test('makeVoteRecord: costruisce il record grezzo correttamente', () => {
  const at = '2026-06-24T10:00:00.000Z';
  const r = UC.makeVoteRecord({ uid: 'u1', feedbackId: 'fb-42', vote: 'works', at });
  assert.equal(r.uid, 'u1');
  assert.equal(r.feedbackId, 'fb-42');
  assert.equal(r.vote, 'works');
  assert.equal(r.at, at);
});

test('makeVoteRecord: round-trip dei campi grezzi (uid, feedbackId, vote, at)', () => {
  const input = { uid: 'user-99', feedbackId: 'fb-77', vote: 'broken', at: '2026-06-24T11:00:00.000Z' };
  const r = UC.makeVoteRecord(input);
  assert.deepEqual(r, input);
});

test('makeVoteRecord: fallback su stringa vuota se campi mancanti', () => {
  const r = UC.makeVoteRecord({});
  assert.equal(typeof r.uid, 'string');
  assert.equal(typeof r.feedbackId, 'string');
  assert.equal(typeof r.vote, 'string');
  assert.equal(typeof r.at, 'string');
});

// ── recordVoteCast ──────────────────────────────────────────────────────────

test('recordVoteCast: incrementa voteCount e aggiorna lastVoteAt', () => {
  const entry = UC.freshEntry('u1');
  const at = '2026-06-24T09:00:00.000Z';
  const updated = UC.recordVoteCast(entry, { at });
  assert.equal(updated.voteCount, 1);
  assert.equal(updated.lastVoteAt, at);
  // Non muta l'originale (PURA).
  assert.equal(entry.voteCount, 0);
});

test('recordVoteCast: cumulativo su più voti', () => {
  let e = UC.freshEntry('u1');
  e = UC.recordVoteCast(e, { at: '2026-06-24T09:00:00.000Z' });
  e = UC.recordVoteCast(e, { at: '2026-06-24T10:00:00.000Z' });
  assert.equal(e.voteCount, 2);
  assert.equal(e.lastVoteAt, '2026-06-24T10:00:00.000Z');
});

// ── recordVoteOutcome ───────────────────────────────────────────────────────

test('recordVoteOutcome: voto corretto → matchCount+1, missCount invariato', () => {
  const entry = UC.freshEntry('u1');
  const updated = UC.recordVoteOutcome(entry, {
    feedbackId: 'fb-1', vote: 'works', finalOutcome: 'works', at: '2026-06-24T12:00:00.000Z',
  });
  assert.equal(updated.matchCount, 1);
  assert.equal(updated.missCount, 0);
  assert.equal(updated.outcomes.length, 1);
  assert.equal(updated.outcomes[0].feedbackId, 'fb-1');
  assert.equal(updated.outcomes[0].vote, 'works');
  assert.equal(updated.outcomes[0].finalOutcome, 'works');
});

test('recordVoteOutcome: voto sbagliato → missCount+1, matchCount invariato', () => {
  const entry = UC.freshEntry('u1');
  const updated = UC.recordVoteOutcome(entry, {
    feedbackId: 'fb-2', vote: 'works', finalOutcome: 'broken',
  });
  assert.equal(updated.matchCount, 0);
  assert.equal(updated.missCount, 1);
});

test('recordVoteOutcome: credibility NON viene modificata (substrato puro)', () => {
  const entry = UC.freshEntry('u1');
  // Anche dopo molti voti corretti, la credibilità non cambia (policy rimandato)
  let e = entry;
  for (let i = 0; i < 10; i++) {
    e = UC.recordVoteOutcome(e, { feedbackId: `fb-${i}`, vote: 'works', finalOutcome: 'works' });
  }
  assert.equal(e.credibility, 1);
});

test('recordVoteOutcome: non muta l\'entry originale (PURA)', () => {
  const entry = UC.freshEntry('u1');
  UC.recordVoteOutcome(entry, { feedbackId: 'fb-x', vote: 'works', finalOutcome: 'works' });
  assert.equal(entry.matchCount, 0);
  assert.equal(entry.outcomes.length, 0);
});

test('recordVoteOutcome: tetto a 50 outcomes (anti-bloat)', () => {
  let e = UC.freshEntry('u1');
  for (let i = 0; i < 60; i++) {
    e = UC.recordVoteOutcome(e, { feedbackId: `fb-${i}`, vote: 'works', finalOutcome: 'works' });
  }
  assert.equal(e.outcomes.length, 50);
  // Teniamo i più recenti (gli ultimi 50 su 60).
  assert.equal(e.outcomes[0].feedbackId, 'fb-10');
  assert.equal(e.outcomes[49].feedbackId, 'fb-59');
});

// ── canEarnFromVote ─────────────────────────────────────────────────────────

test('canEarnFromVote: pass-through con flag spento (default oggi)', () => {
  // credibility = 1 → passa
  assert.equal(UC.canEarnFromVote(1), true);
  // credibility = 0 → passa (flag spento)
  assert.equal(UC.canEarnFromVote(0), true);
  // credibility molto bassa → passa (flag spento)
  assert.equal(UC.canEarnFromVote(0.001), true);
  // flagEnabled esplicitamente false → pass-through
  assert.equal(UC.canEarnFromVote(0, { flagEnabled: false }), true);
});

test('canEarnFromVote: con flag spento, anche credibilità assente passa', () => {
  assert.equal(UC.canEarnFromVote(null), true);
  assert.equal(UC.canEarnFromVote(undefined), true);
  assert.equal(UC.canEarnFromVote(NaN), true);
});

test('canEarnFromVote: con flag acceso e soglia > 0, credibilità bassa non passa', () => {
  // flagEnabled: true, threshold: 0.5
  assert.equal(UC.canEarnFromVote(0.3, { flagEnabled: true, threshold: 0.5 }), false);
  assert.equal(UC.canEarnFromVote(0.5, { flagEnabled: true, threshold: 0.5 }), true);
  assert.equal(UC.canEarnFromVote(1,   { flagEnabled: true, threshold: 0.5 }), true);
});

test('canEarnFromVote: con flag acceso e soglia = 0, tutti passano', () => {
  assert.equal(UC.canEarnFromVote(0,   { flagEnabled: true, threshold: 0 }), true);
  assert.equal(UC.canEarnFromVote(0.1, { flagEnabled: true, threshold: 0 }), true);
});

// ── integrazione: getCredibility round-trip via freshEntry ──────────────────

test('getCredibility: legge DEFAULT (1) da un freshEntry appena creato', () => {
  const entry = UC.freshEntry('uid-test');
  const store = { 'uid-test': entry };
  assert.equal(UC.getCredibility('uid-test', store), 1);
});

test('getCredibility: legge il valore aggiornato se entry è modificata', () => {
  const entry = { credibility: 1.8, voteCount: 5, matchCount: 4, missCount: 1 };
  const store = { 'uid-upd': entry };
  assert.equal(UC.getCredibility('uid-upd', store), 1.8);
});
