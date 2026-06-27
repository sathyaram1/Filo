// Unit test per il substrato dei VOTI di verifica dei feedback (DB4,
// src/shared/feedback.js): normalizeVotes / tallyVotes / userVote, più il
// round-trip dell'encoding Firestore (toFsValue → fromFsValue) di un map di
// voti. Logica pura: gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedback.js'));

const FB = globalThis.SN_FEEDBACK;

test('feedback espone il substrato voti', () => {
  assert.equal(typeof FB.normalizeVotes, 'function');
  assert.equal(typeof FB.tallyVotes, 'function');
  assert.equal(typeof FB.userVote, 'function');
  assert.equal(typeof FB.castVote, 'function');
  assert.equal(typeof FB.clearVote, 'function');
  assert.deepEqual(FB.VOTE_VALUES, ['works', 'broken']);
});

// ── normalizeVotes ──────────────────────────────────────────────────────────

test('normalizeVotes: tiene solo le entry ben formate', () => {
  const raw = {
    u1: { vote: 'works', at: '2026-06-24T00:00:00.000Z', credibilitySnapshot: 2 },
    u2: { vote: 'broken', at: '2026-06-24T00:00:00.000Z', credibilitySnapshot: 1 },
    bad1: { vote: 'maybe' },        // vote non valido → scartato
    bad2: 'works',                  // non-oggetto → scartato
    bad3: null,                     // null → scartato
  };
  const out = FB.normalizeVotes(raw);
  assert.deepEqual(Object.keys(out).sort(), ['u1', 'u2']);
  assert.equal(out.u1.vote, 'works');
  assert.equal(out.u2.vote, 'broken');
});

test('normalizeVotes: default credibilità = 1, at mancante = stringa vuota', () => {
  const out = FB.normalizeVotes({
    a: { vote: 'works' },                              // no cred, no at
    b: { vote: 'broken', credibilitySnapshot: -5 },    // cred negativa → 1
    c: { vote: 'works', credibilitySnapshot: 'x' },    // cred non numerica → 1
    d: { vote: 'broken', at: 42 },                     // at non stringa → ''
  });
  assert.equal(out.a.credibilitySnapshot, 1);
  assert.equal(out.a.at, '');
  assert.equal(out.b.credibilitySnapshot, 1);
  assert.equal(out.c.credibilitySnapshot, 1);
  assert.equal(out.d.at, '');
});

test('normalizeVotes: input non valido → map vuoto', () => {
  assert.deepEqual(FB.normalizeVotes(null), {});
  assert.deepEqual(FB.normalizeVotes(undefined), {});
  assert.deepEqual(FB.normalizeVotes('nope'), {});
  assert.deepEqual(FB.normalizeVotes({}), {});
});

// ── tallyVotes ──────────────────────────────────────────────────────────────

test('tallyVotes: conteggi e punteggio pesato per credibilità', () => {
  const t = FB.tallyVotes({
    a: { vote: 'works', credibilitySnapshot: 2 },
    b: { vote: 'works', credibilitySnapshot: 1 },
    c: { vote: 'broken', credibilitySnapshot: 1 },
  });
  // works: 2+1 = 3 ; broken: 1 ; score = 3 − 1 = 2
  assert.deepEqual(t, { works: 2, broken: 1, total: 3, score: 2 });
});

test('tallyVotes: voti opposti pari → score 0', () => {
  const t = FB.tallyVotes({
    a: { vote: 'works' },
    b: { vote: 'broken' },
  });
  assert.equal(t.total, 2);
  assert.equal(t.score, 0);
});

test('tallyVotes: nessun voto → tutto a zero', () => {
  assert.deepEqual(FB.tallyVotes({}), { works: 0, broken: 0, total: 0, score: 0 });
});

// ── userVote ────────────────────────────────────────────────────────────────

test('userVote: ritorna il voto del singolo utente o null', () => {
  const votes = { u1: { vote: 'works' }, u2: { vote: 'broken' } };
  assert.equal(FB.userVote(votes, 'u1'), 'works');
  assert.equal(FB.userVote(votes, 'u2'), 'broken');
  assert.equal(FB.userVote(votes, 'mai-votato'), null);
  assert.equal(FB.userVote(votes, ''), null);
  assert.equal(FB.userVote(null, 'u1'), null);
});

// ── round-trip dell'encoding Firestore (schema sul documento) ───────────────

test('round-trip: un map di voti sopravvive a toFsValue → fromFsValue', () => {
  const votes = {
    u1: { vote: 'works', at: '2026-06-24T10:00:00.000Z', credibilitySnapshot: 1 },
    u2: { vote: 'broken', at: '2026-06-24T11:00:00.000Z', credibilitySnapshot: 3 },
  };
  const encoded = FB.toFsValue(votes);
  // È un mapValue annidato (la forma con cui finisce nel doc feedback).
  assert.ok(encoded.mapValue, 'votes va serializzato come mapValue');
  const decoded = FB.fromFsValue(encoded);
  assert.deepEqual(decoded, votes);
  // E il tally calcolato dal valore decodificato è coerente.
  assert.deepEqual(FB.tallyVotes(decoded), { works: 1, broken: 1, total: 2, score: -2 });
});
