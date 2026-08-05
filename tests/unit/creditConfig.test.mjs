// Unit test per gli IMPORTI CREDITI CONFIGURABILI (#366.2, backend).
//
// Verifica che il motore crediti (logica pura, SN_CREDITS) usi gli importi di una
// config passata come PARAMETRO quando presente, e ripieghi ESATTAMENTE sui
// default storici (costanti CREDIT) quando la config manca o è sballata.
//
// Perché questi test SERVONO (asserire il successo, non l'assenza di errore):
// rimettendo il motore com'era prima (freshState/applyRefill/rewardForPriority
// che leggevano direttamente le costanti CREDIT e non il parametro config), i
// test sull'override e sullo zero-per-fascia diventano ROSSI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
require(join(__dirname, '..', '..', 'src', 'main', 'services', 'creditStore.js'));

const C = globalThis.SN_CREDITS;
const { CREDIT } = globalThis.SN_CONST;

// ── validAmount: cos'è un importo e cosa no ─────────────────────────────────
test('validAmount: numeri >= 0 accettati, incluso 0 esplicito', () => {
  assert.equal(C.validAmount(0), 0);
  assert.equal(C.validAmount(250), 250);
  assert.equal(C.validAmount(12.5), 12.5);
});

test('validAmount: stringhe numeriche accettate (Firestore consegna interi come stringa)', () => {
  assert.equal(C.validAmount('0'), 0);
  assert.equal(C.validAmount('2500'), 2500);
  assert.equal(C.validAmount('  100  '), 100);
});

test('validAmount: valori NON numerici o negativi rifiutati (→ null)', () => {
  for (const bad of [true, false, -1, '-5', NaN, Infinity, -Infinity, '', '   ',
    'abc', 'ciao', '5px', {}, [], [5], null, undefined, '10.0.0', '💥']) {
    assert.equal(C.validAmount(bad), null, `dovrebbe rifiutare ${JSON.stringify(bad)}`);
  }
});

// ── resolveCreditConfig: default vs override, per campo ─────────────────────
test('resolveCreditConfig(): senza config → tutti i default storici', () => {
  const cfg = C.resolveCreditConfig();
  assert.equal(cfg.initial, CREDIT.INITIAL);
  assert.equal(cfg.dailyRefill, CREDIT.DAILY_REFILL);
  assert.equal(cfg.maxRefillDays, CREDIT.MAX_REFILL_DAYS);
  assert.equal(cfg.feedbackSend, CREDIT.FEEDBACK_SEND);
  assert.equal(cfg.boardVote, CREDIT.BOARD_VOTE);
  assert.equal(cfg.boardReopen, CREDIT.BOARD_REOPEN);
  assert.deepEqual(cfg.feedbackResolveByPriority, { 0: 50, 1: 100, 2: 200, 3: 300 });
});

test('resolveCreditConfig(): config completa → tutti gli importi nuovi', () => {
  const cfg = C.resolveCreditConfig({
    initial: 2500, dailyRefill: 250, maxRefillDays: 3, feedbackSend: 7,
    boardVote: 20, boardReopen: 123,
    feedbackResolveByPriority: { 0: 11, 1: 22, 2: 33, 3: 44 },
  });
  assert.equal(cfg.initial, 2500);
  assert.equal(cfg.dailyRefill, 250);
  assert.equal(cfg.maxRefillDays, 3);
  assert.equal(cfg.feedbackSend, 7);
  assert.equal(cfg.boardVote, 20);
  assert.equal(cfg.boardReopen, 123);
  assert.deepEqual(cfg.feedbackResolveByPriority, { 0: 11, 1: 22, 2: 33, 3: 44 });
});

test('resolveCreditConfig(): config PARZIALE → solo i campi passati cambiano', () => {
  const cfg = C.resolveCreditConfig({ initial: 5000 });
  assert.equal(cfg.initial, 5000);
  assert.equal(cfg.dailyRefill, CREDIT.DAILY_REFILL);   // invariato
  assert.equal(cfg.boardReopen, CREDIT.BOARD_REOPEN);   // invariato
});

test('resolveCreditConfig(): valori sballati IGNORATI campo per campo', () => {
  const cfg = C.resolveCreditConfig({
    initial: -100,            // negativo → default
    dailyRefill: 'tanti',     // testo → default
    boardReopen: true,        // booleano → default
    feedbackSend: '   ',      // spazi → default
    boardVote: 42,            // valido → usato
  });
  assert.equal(cfg.initial, CREDIT.INITIAL);
  assert.equal(cfg.dailyRefill, CREDIT.DAILY_REFILL);
  assert.equal(cfg.boardReopen, CREDIT.BOARD_REOPEN);
  assert.equal(cfg.feedbackSend, CREDIT.FEEDBACK_SEND);
  assert.equal(cfg.boardVote, 42);
});

test('resolveCreditConfig(): stringa numerica accettata (int-as-string di Firestore)', () => {
  const cfg = C.resolveCreditConfig({ initial: '2500', dailyRefill: '250' });
  assert.equal(cfg.initial, 2500);
  assert.equal(cfg.dailyRefill, 250);
});

// ── freshState: saldo di benvenuto configurabile ────────────────────────────
test('freshState: default = 1000; con config initial → il nuovo saldo', () => {
  assert.equal(C.freshState('2026-06-17').balance, CREDIT.INITIAL);
  assert.equal(C.freshState('2026-06-17').balance, 1000);
  assert.equal(C.freshState('2026-06-17', { initial: 2500 }).balance, 2500);
});

// ── applyRefill: ricarica giornaliera e tetto configurabili ─────────────────
test('applyRefill: default +100/giorno (nessuna config)', () => {
  const s = C.freshState('2026-06-16');
  const { added, state } = C.applyRefill(s, '2026-06-17');
  assert.equal(added, 100);
  assert.equal(state.balance, 1100);
});

test('applyRefill: con config dailyRefill=250 → +250 per giorno', () => {
  const s = C.freshState('2026-06-16', { initial: 1000 });
  const { added, state } = C.applyRefill(s, '2026-06-17', false, { dailyRefill: 250 });
  assert.equal(added, 250);
  assert.equal(state.balance, 1250);
});

test('applyRefill: tetto giorni configurabile (maxRefillDays=3, 100 giorni assenza)', () => {
  const s = C.freshState('2026-01-01', { initial: 0 });
  const { added } = C.applyRefill(s, '2026-04-11', false, { dailyRefill: 10, maxRefillDays: 3 });
  assert.equal(added, 30); // 3 giorni * 10, non 100 giorni
});

// ── rewardForPriority: premi per priorità + LO ZERO PER FASCIA ──────────────
test('rewardForPriority: default 50/100/200/300', () => {
  assert.equal(C.rewardForPriority(0), 50);
  assert.equal(C.rewardForPriority(1), 100);
  assert.equal(C.rewardForPriority(2), 200);
  assert.equal(C.rewardForPriority(3), 300);
});

test('rewardForPriority: config → i nuovi premi per fascia', () => {
  const cfg = { feedbackResolveByPriority: { 0: 11, 1: 22, 2: 33, 3: 44 } };
  assert.equal(C.rewardForPriority(0, cfg), 11);
  assert.equal(C.rewardForPriority(1, cfg), 22);
  assert.equal(C.rewardForPriority(2, cfg), 33);
  assert.equal(C.rewardForPriority(3, cfg), 44);
});

// Il bug storico: azzerare UNA fascia faceva pagare la fascia 0 invece di 0.
test('rewardForPriority: 0 ESPLICITO in una fascia paga 0, NON la fascia 0', () => {
  const cfg = { feedbackResolveByPriority: { 0: 50, 1: 0, 2: 0, 3: 0 } };
  assert.equal(C.rewardForPriority(0, cfg), 50);
  assert.equal(C.rewardForPriority(1, cfg), 0);  // era 50 col vecchio ripiego → bug
  assert.equal(C.rewardForPriority(2, cfg), 0);
  assert.equal(C.rewardForPriority(3, cfg), 0);
});

test('rewardForPriority: fascia con valore sballato → ripiega sulla SUA fascia di default (non la 0)', () => {
  const cfg = { feedbackResolveByPriority: { 0: 50, 2: 'boh' } };
  assert.equal(C.rewardForPriority(2, cfg), 200); // default della fascia 2, non 50
  assert.equal(C.rewardForPriority(3, cfg), 300); // fascia non toccata = default suo
});

test('rewardForPriority: priorità fuori scala clampata su [0..3]', () => {
  const cfg = { feedbackResolveByPriority: { 0: 11, 1: 22, 2: 33, 3: 44 } };
  assert.equal(C.rewardForPriority(-5, cfg), 11); // → fascia 0
  assert.equal(C.rewardForPriority(99, cfg), 44); // → fascia 3
});

// ── amount(): comodo per gli handler ────────────────────────────────────────
test('amount(): importo singolo risolto (default e override)', () => {
  assert.equal(C.amount('feedbackSend'), CREDIT.FEEDBACK_SEND);
  assert.equal(C.amount('boardReopen'), CREDIT.BOARD_REOPEN);
  assert.equal(C.amount('feedbackSend', { feedbackSend: 42 }), 42);
  assert.equal(C.amount('boardReopen', { boardReopen: 0 }), 0); // zero esplicito
});

// ── setConfigSource: iniezione runtime (senza passare config esplicita) ─────
test('setConfigSource: la sorgente iniettata alimenta le funzioni senze param', () => {
  try {
    C.setConfigSource(() => ({ initial: 777, dailyRefill: 5,
      feedbackResolveByPriority: { 0: 1, 1: 2, 2: 3, 3: 4 } }));
    // Nessun parametro esplicito → usa la sorgente iniettata.
    assert.equal(C.freshState('2026-06-17').balance, 777);
    assert.equal(C.rewardForPriority(2), 3);
    assert.equal(C.amount('dailyRefill'), 5);
    // Un parametro ESPLICITO vince comunque sulla sorgente.
    assert.equal(C.freshState('2026-06-17', { initial: 10 }).balance, 10);
    // Config esplicita null → default (ignora la sorgente).
    assert.equal(C.freshState('2026-06-17', null).balance, CREDIT.INITIAL);
  } finally {
    C.setConfigSource(null); // ripristina: i test successivi devono vedere i default
  }
});

test('setConfigSource(null): tornati ai default storici', () => {
  assert.equal(C.freshState('2026-06-17').balance, CREDIT.INITIAL);
  assert.equal(C.rewardForPriority(2), 200);
});

test('setConfigSource: una sorgente che lancia non rompe (ripiega sui default)', () => {
  try {
    C.setConfigSource(() => { throw new Error('boom'); });
    assert.equal(C.freshState('2026-06-17').balance, CREDIT.INITIAL);
    assert.equal(C.amount('boardVote'), CREDIT.BOARD_VOTE);
  } finally {
    C.setConfigSource(null);
  }
});
