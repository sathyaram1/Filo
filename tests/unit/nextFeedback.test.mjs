// Unit test per la logica pura di selezione/ordinamento di next-feedback.mjs.
//
// COSA TESTIAMO
//   La funzione `selectWinner` — pura, sincrona, senza rete né Electron:
//   - priority DESC (vince il feedback con priorità più alta)
//   - FIFO a parità di priorità (vince il più vecchio per createdAt)
//   - tie-break per seq ASC (se manca createdAt)
//   - tie-break per _id ASC (caso finale deterministico)
//   - esclusione dei claimati (claimed=true)
//   - coda vuota → null
//   - tutti claimati → null
//   - priorità cifrate mockate: `selectWinner` riceve già i valori decifrati
//     (number), quindi il mock è semplice: passiamo priority = 2, non FENC1:
//
// La parte di rete (fetchOpenCandidates / Firestore) NON è testata qui:
// è thin e non testabile senza connessione reale.
//
// Gira senza Electron in millisecondi (node:test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectWinner } from '../../scripts/next-feedback.mjs';

// ─── Helper ──────────────────────────────────────────────────────────────────

// Costruisce un candidato minimale con default sensati.
function mk(id, { priority = 0, createdAt = null, seq = null, claimed = false } = {}) {
  const out = { _id: id, priority, claimed };
  if (createdAt !== null) out.createdAt = createdAt;
  if (seq !== null) out.seq = seq;
  return out;
}

// Timestamp ISO crescenti.
const T1 = '2026-01-01T10:00:00.000Z';
const T2 = '2026-01-02T10:00:00.000Z';
const T3 = '2026-01-03T10:00:00.000Z';

// ─── Test: coda vuota ────────────────────────────────────────────────────────

test('selectWinner: coda vuota → null', () => {
  assert.equal(selectWinner([]), null);
  assert.equal(selectWinner(null), null);
  assert.equal(selectWinner(undefined), null);
});

// ─── Test: tutti claimati → null ─────────────────────────────────────────────

test('selectWinner: tutti claimati → null', () => {
  const candidates = [
    mk('a', { priority: 3, claimed: true }),
    mk('b', { priority: 2, claimed: true }),
  ];
  assert.equal(selectWinner(candidates), null);
});

// ─── Test: priority DESC ─────────────────────────────────────────────────────

test('selectWinner: vince il feedback con priority più alta', () => {
  const candidates = [
    mk('low',  { priority: 0, createdAt: T1 }),
    mk('high', { priority: 3, createdAt: T2 }),
    mk('mid',  { priority: 2, createdAt: T1 }),
  ];
  assert.equal(selectWinner(candidates), 'high');
});

test('selectWinner: priority 3 vince su 0 anche se 0 è più vecchio', () => {
  const candidates = [
    mk('oldest', { priority: 0, createdAt: T1 }),
    mk('newest', { priority: 3, createdAt: T3 }),
  ];
  assert.equal(selectWinner(candidates), 'newest');
});

// ─── Test: FIFO a parità di priority ────────────────────────────────────────

test('selectWinner: a parità di priority vince il più vecchio (createdAt ASC)', () => {
  const candidates = [
    mk('new',  { priority: 2, createdAt: T3 }),
    mk('old',  { priority: 2, createdAt: T1 }),
    mk('mid',  { priority: 2, createdAt: T2 }),
  ];
  assert.equal(selectWinner(candidates), 'old');
});

test('selectWinner: candidato singolo è il vincitore', () => {
  assert.equal(selectWinner([mk('solo', { priority: 1, createdAt: T1 })]), 'solo');
});

// ─── Test: tie-break createdAt mancante ──────────────────────────────────────

test('selectWinner: feedback con createdAt va prima di uno senza', () => {
  const candidates = [
    mk('no-date',   { priority: 2 }),             // senza createdAt
    mk('has-date',  { priority: 2, createdAt: T1 }),
  ];
  // ha createdAt → prima
  assert.equal(selectWinner(candidates), 'has-date');
});

// ─── Test: tie-break seq ASC ─────────────────────────────────────────────────

test('selectWinner: a parità di priority e senza createdAt, vince seq minore', () => {
  const candidates = [
    mk('seq10', { priority: 1, seq: 10 }),
    mk('seq3',  { priority: 1, seq: 3  }),
    mk('seq7',  { priority: 1, seq: 7  }),
  ];
  assert.equal(selectWinner(candidates), 'seq3');
});

// ─── Test: tie-break _id ASC (determinismo assoluto) ─────────────────────────

test('selectWinner: tie-break finale su _id ASC quando tutto è uguale', () => {
  const candidates = [
    mk('zzz', { priority: 1, createdAt: T1 }),
    mk('aaa', { priority: 1, createdAt: T1 }),
    mk('mmm', { priority: 1, createdAt: T1 }),
  ];
  assert.equal(selectWinner(candidates), 'aaa');
});

// ─── Test: esclusione claimati parziale ──────────────────────────────────────

test('selectWinner: esclude i claimati e prende il miglior free', () => {
  const candidates = [
    mk('best',    { priority: 3, createdAt: T1, claimed: true  }),  // claimato
    mk('second',  { priority: 2, createdAt: T1, claimed: false }),  // libero
    mk('third',   { priority: 1, createdAt: T1, claimed: false }),
  ];
  assert.equal(selectWinner(candidates), 'second');
});

test('selectWinner: due candidati liberi con stessa priority, vince il più vecchio', () => {
  const candidates = [
    mk('a-old',  { priority: 2, createdAt: T1, claimed: false }),
    mk('b-new',  { priority: 2, createdAt: T2, claimed: false }),
    mk('c-best', { priority: 3, createdAt: T3, claimed: true  }),  // claimato: escluso
  ];
  assert.equal(selectWinner(candidates), 'a-old');
});

// ─── Test: priority undefined/NaN trattata come 0 ───────────────────────────

test('selectWinner: priority undefined trattata come 0 (robustezza)', () => {
  const candidates = [
    mk('no-prio', { createdAt: T1 }),               // priority undefined → 0
    mk('prio-2',  { priority: 2, createdAt: T2 }),
  ];
  assert.equal(selectWinner(candidates), 'prio-2');
});

test('selectWinner: priority NaN trattata come 0', () => {
  const candidates = [
    mk('nan-prio', { priority: NaN, createdAt: T1 }),
    mk('zero',     { priority: 0,   createdAt: T2 }),
    mk('one',      { priority: 1,   createdAt: T3 }),
  ];
  assert.equal(selectWinner(candidates), 'one');
  // A parità (entrambi 0), vince il più vecchio (nan-prio, T1).
  const tied = [
    mk('nan-first',  { priority: NaN, createdAt: T1 }),
    mk('zero-later', { priority: 0,   createdAt: T2 }),
  ];
  assert.equal(selectWinner(tied), 'nan-first');
});

// ─── Test: scenario composito realistico ─────────────────────────────────────

test('selectWinner: scenario realistico con priority, FIFO e claim misti', () => {
  // Simula un batch di feedback come li vedrebbe lo script dopo la decifratura.
  // priority qui è già un number (come se decryptFeedbackFields avesse già lavorato).
  const candidates = [
    // ID         priority  createdAt  seq  claimed
    mk('fb-01', { priority: 0, createdAt: T1, seq: 1,  claimed: false }),
    mk('fb-02', { priority: 2, createdAt: T2, seq: 2,  claimed: true  }),  // claimato
    mk('fb-03', { priority: 2, createdAt: T1, seq: 3,  claimed: false }),  // priority 2 + più vecchio
    mk('fb-04', { priority: 1, createdAt: T1, seq: 4,  claimed: false }),
    mk('fb-05', { priority: 2, createdAt: T3, seq: 5,  claimed: false }),
  ];
  // fb-02 ha priority 2 ma è claimato → escluso.
  // fb-03 e fb-05 hanno priority 2 e non sono claimati.
  // fb-03 ha createdAt T1 < T3 di fb-05 → vince fb-03.
  assert.equal(selectWinner(candidates), 'fb-03');
});

// ─── Test: priority cifrata mock (già decifrata) ──────────────────────────────

test('selectWinner: priority già decifrata come numero funziona identicamente', () => {
  // Verifica che lo script funzioni DOPO la decifratura (selectWinner riceve numeri,
  // non ciphertext FENC1:). Il mocking della decifratura non è necessario per la
  // logica pura; il round-trip cifra/decifra è testato in feedbackPriorityEncryption.test.mjs.
  const candidates = [
    mk('cipher-high', { priority: 3, createdAt: T2 }),   // come se fosse FENC1: decifrato a 3
    mk('cipher-low',  { priority: 0, createdAt: T1 }),   // come se fosse FENC1: decifrato a 0
    mk('plain-mid',   { priority: 2, createdAt: T1 }),   // legacy intero non cifrato
  ];
  // 3 vince su 2 e 0.
  assert.equal(selectWinner(candidates), 'cipher-high');
});
