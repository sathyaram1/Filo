// Unit test per l'archiviazione automatica a punteggio (DC3,
// src/shared/boardArchive.js): shouldAutoArchive / usersSayBroken /
// hasOwnerOverride / applyAutoArchive.
//
// Riusa il VERO SN_FEEDBACK.tallyVotes (DB4) per costruire il punteggio dai
// voti, così il test esercita la formula reale (Σ credibilità works − Σ
// credibilità broken), non un duplicato. Carica anche manageReview.js (DB3,
// isShipped) perché shouldAutoArchive lo richiede per il gate "in produzione".
//
// Logica pura: gira via `npm run test:unit` senza Electron né rete.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedback.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'manageReview.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'boardArchive.js'));

const BA = globalThis.SN_BOARD_ARCHIVE;
const FB = globalThis.SN_FEEDBACK;

const RELEASED = '0.2.80';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-24T12:00:00.000Z').getTime();

// Costruisce un feedback "Risolti" (shipped) con N voti works/broken, usando
// il vero formato { vote, at, credibilitySnapshot } che FB.tallyVotes legge.
function shippedFeedback({ resolvedAt, works = 0, broken = 0, status = 'done', extra = {} } = {}) {
  const votes = {};
  for (let i = 0; i < works; i++) votes[`u-works-${i}`] = { vote: 'works', at: resolvedAt, credibilitySnapshot: 1 };
  for (let i = 0; i < broken; i++) votes[`u-broken-${i}`] = { vote: 'broken', at: resolvedAt, credibilitySnapshot: 1 };
  return {
    _id: 'fb-' + Math.random().toString(36).slice(2),
    status,
    resolvedInVersion: RELEASED,
    resolvedAt,
    votes,
    ...extra,
  };
}

test('espone le funzioni pure attese', () => {
  assert.equal(typeof BA.shouldAutoArchive, 'function');
  assert.equal(typeof BA.usersSayBroken, 'function');
  assert.equal(typeof BA.hasOwnerOverride, 'function');
  assert.equal(typeof BA.applyAutoArchive, 'function');
  assert.equal(BA.DEFAULTS.AUTO_ARCHIVE_THRESHOLD, 2);
  assert.equal(BA.DEFAULTS.NEGATIVE_THRESHOLD, -2);
  assert.equal(BA.DEFAULTS.MIN_AGE_MS, DAY_MS);
});

// ── Done 1: soglia raggiunta dopo 24h → archivia ────────────────────────────

test('punteggio >= soglia E >= 24h dalla produzione → ARCHIVIA', () => {
  const resolvedAt = new Date(NOW - 25 * 60 * 60 * 1000).toISOString(); // 25h fa
  const fb = shippedFeedback({ resolvedAt, works: 2, broken: 0 }); // score = 2
  // Verifica che usiamo davvero tallyVotes reale.
  assert.equal(FB.tallyVotes(fb.votes).score, 2);
  const decision = BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED });
  assert.equal(decision, true);
});

// ── Done 2: sotto soglia → NON archivia ─────────────────────────────────────

test('punteggio sotto soglia (anche dopo 24h+) → NON archivia', () => {
  const resolvedAt = new Date(NOW - 48 * 60 * 60 * 1000).toISOString(); // 48h fa
  const fb = shippedFeedback({ resolvedAt, works: 1, broken: 0 }); // score = 1 < 2
  assert.equal(FB.tallyVotes(fb.votes).score, 1);
  const decision = BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED });
  assert.equal(decision, false);
});

// ── Done 3: punteggio alto ma < 24h trascorse → NON archivia ────────────────

test('punteggio alto ma meno di 24h dalla produzione → NON archivia', () => {
  const resolvedAt = new Date(NOW - 2 * 60 * 60 * 1000).toISOString(); // 2h fa
  const fb = shippedFeedback({ resolvedAt, works: 10, broken: 0 }); // score = 10 (altissimo)
  assert.equal(FB.tallyVotes(fb.votes).score, 10);
  const decision = BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED });
  assert.equal(decision, false);
});

test('esattamente a 24h (boundary) → archivia; a 23h59 → no', () => {
  const at24h = new Date(NOW - DAY_MS).toISOString();
  const at23h59 = new Date(NOW - DAY_MS + 60000).toISOString();
  const fbAt24 = shippedFeedback({ resolvedAt: at24h, works: 3, broken: 0 });
  const fbAt23 = shippedFeedback({ resolvedAt: at23h59, works: 3, broken: 0 });
  assert.equal(BA.shouldAutoArchive(fbAt24, { now: NOW, releasedVersion: RELEASED }), true);
  assert.equal(BA.shouldAutoArchive(fbAt23, { now: NOW, releasedVersion: RELEASED }), false);
});

// ── Done 4: punteggio fortemente negativo → emerge ma NON archivia/riapre ───

test('punteggio fortemente negativo → usersSayBroken=true, shouldAutoArchive=false, status invariato', () => {
  const resolvedAt = new Date(NOW - 48 * 60 * 60 * 1000).toISOString(); // ben oltre 24h
  const fb = shippedFeedback({ resolvedAt, works: 0, broken: 3 }); // score = -3 <= -2
  assert.equal(FB.tallyVotes(fb.votes).score, -3);

  assert.equal(BA.usersSayBroken(fb, { negativeThreshold: -2 }), true);
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED }), false);
  // Né archiviato né riaperto: lo status del feedback resta quello con cui è
  // entrato (qui 'done') — la funzione è una pura proiezione, non muta nulla.
  assert.equal(fb.status, 'done');
});

test('punteggio negativo ma sopra la soglia negativa (es. -1) → NON emerge', () => {
  const resolvedAt = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();
  const fb = shippedFeedback({ resolvedAt, works: 1, broken: 2 }); // score = -1
  assert.equal(FB.tallyVotes(fb.votes).score, -1);
  assert.equal(BA.usersSayBroken(fb, { negativeThreshold: -2 }), false);
});

// ── Done 5: override owner → archivia subito, a prescindere da punteggio/età ─

test("override owner 'archived' su feedback fresco e senza voti → shouldAutoArchive resta false (già fatto a mano, non rifare)", () => {
  // Nota: quando l'owner ha GIA' archiviato (status archived) la funzione
  // ritorna false per idempotenza — non è "non vince l'override", è che il
  // lavoro è già stato fatto. Il vero test dell'override è il prossimo: un
  // override 'keep_open' che blocca un punteggio altrimenti vincente.
  const resolvedAt = new Date(NOW - 1000).toISOString(); // 1 secondo fa
  const fb = shippedFeedback({ resolvedAt, works: 0, broken: 0, status: 'archived', extra: { archiveOverride: 'archived' } });
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED }), false);
  assert.equal(BA.hasOwnerOverride(fb), 'archived');
});

test("override owner 'keep_open' blocca l'auto-archiviazione anche con punteggio alto e 48h trascorse", () => {
  const resolvedAt = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();
  const fb = shippedFeedback({
    resolvedAt, works: 10, broken: 0,
    extra: { archiveOverride: 'keep_open' },
  }); // score altissimo, ben oltre 24h: senza override archivierebbe
  assert.equal(FB.tallyVotes(fb.votes).score, 10);
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED }), false);
  assert.equal(BA.hasOwnerOverride(fb), 'keep_open');
});

test('applyAutoArchive: applica subito un feedback con override owner esplicito via percorso manuale (status già archived) → resta fuori da toArchive', () => {
  const resolvedAt = new Date(NOW - 1000).toISOString();
  const fb = shippedFeedback({ resolvedAt, works: 0, broken: 0, status: 'archived', extra: { archiveOverride: 'archived' } });
  const { toArchive } = BA.applyAutoArchive([fb], { now: NOW, releasedVersion: RELEASED });
  assert.deepEqual(toArchive, []); // già archiviato: niente da fare
});

// ── applyAutoArchive: scenario misto (lista realistica) ─────────────────────

test('applyAutoArchive: separa correttamente chi va archiviato da chi va solo segnalato', () => {
  const old = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();

  const winner = shippedFeedback({ resolvedAt: old, works: 3, broken: 0 }); // archivia
  const loser = shippedFeedback({ resolvedAt: old, works: 0, broken: 3 }); // emerge (negativo)
  const tooSoon = shippedFeedback({ resolvedAt: fresh, works: 5, broken: 0 }); // alto ma troppo recente
  const belowThreshold = shippedFeedback({ resolvedAt: old, works: 1, broken: 0 }); // score 1, non basta
  const overridden = shippedFeedback({ resolvedAt: old, works: 5, broken: 0, extra: { archiveOverride: 'keep_open' } });

  const { toArchive, toFlag } = BA.applyAutoArchive(
    [winner, loser, tooSoon, belowThreshold, overridden],
    { now: NOW, releasedVersion: RELEASED },
  );

  assert.deepEqual(toArchive, [winner._id]);
  assert.deepEqual(toFlag, [loser._id]);
});

// ── Gate "in produzione" (DB3) ───────────────────────────────────────────────

test('senza releasedVersion (gate DB3 non disponibile) → non decide, NON archivia alla cieca', () => {
  const resolvedAt = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();
  const fb = shippedFeedback({ resolvedAt, works: 10, broken: 0 });
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW }), false);
});

test('resolvedInVersion futura (non ancora spedito, DB3) → NON archivia anche con punteggio e 24h+', () => {
  const resolvedAt = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();
  const fb = shippedFeedback({ resolvedAt, works: 10, broken: 0, extra: { resolvedInVersion: '9.9.9' } });
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED }), false);
});

test('già archiviato → idempotente, non richiede ri-elaborazione', () => {
  const resolvedAt = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();
  const fb = shippedFeedback({ resolvedAt, works: 10, broken: 0, status: 'archived' });
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED }), false);
});

test('fallback senza resolvedAt: usa il voto più vecchio come ancoraggio temporale', () => {
  const oldVoteAt = new Date(NOW - 30 * 60 * 60 * 1000).toISOString(); // 30h fa
  const recentVoteAt = new Date(NOW - 5 * 60 * 60 * 1000).toISOString(); // 5h fa
  const fb = {
    _id: 'legacy-1',
    status: 'done',
    resolvedInVersion: RELEASED,
    // NESSUN resolvedAt (storico pre-DB3).
    votes: {
      u1: { vote: 'works', at: oldVoteAt, credibilitySnapshot: 1 },
      u2: { vote: 'works', at: recentVoteAt, credibilitySnapshot: 1 },
    },
  };
  // productionTime dovrebbe usare il voto più vecchio (30h fa) → supera i 24h.
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED }), true);
});

test('nessun resolvedAt e nessun voto → nessun ancoraggio temporale, NON decide', () => {
  const fb = { _id: 'no-anchor', status: 'done', resolvedInVersion: RELEASED, votes: {} };
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED }), false);
});

// ── Soglie personalizzate ────────────────────────────────────────────────────

test('soglia personalizzata (threshold più alta) richiede più voti', () => {
  const resolvedAt = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();
  const fb = shippedFeedback({ resolvedAt, works: 3, broken: 0 }); // score 3
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED, threshold: 2 }), true);
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED, threshold: 5 }), false);
});

test('minAgeMs personalizzato (finestra più corta/lunga)', () => {
  const resolvedAt = new Date(NOW - 3 * 60 * 60 * 1000).toISOString(); // 3h fa
  const fb = shippedFeedback({ resolvedAt, works: 3, broken: 0 });
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED, minAgeMs: 60 * 60 * 1000 }), true); // 1h basta
  assert.equal(BA.shouldAutoArchive(fb, { now: NOW, releasedVersion: RELEASED, minAgeMs: DAY_MS }), false); // 24h non basta
});

// ── hasOwnerOverride: valori non validi ───────────────────────────────────────

test('hasOwnerOverride: valori assenti/non validi → null (nessun override)', () => {
  assert.equal(BA.hasOwnerOverride({}), null);
  assert.equal(BA.hasOwnerOverride({ archiveOverride: '' }), null);
  assert.equal(BA.hasOwnerOverride({ archiveOverride: 'qualcosaltro' }), null);
  assert.equal(BA.hasOwnerOverride(null), null);
});
