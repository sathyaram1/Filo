// Unit test per gli IMPORTI CREDITI configurabili dall'owner (#366.2).
//
// Copre due strati, entrambi logica PURA (niente Electron, niente rete):
//   1. src/shared/creditConfig.js — normalizzazione del documento di config
//      globale (default = costanti CREDIT; campi mancanti/sporchi → default;
//      zero esplicito rispettato);
//   2. src/main/services/creditStore.js — il motore usa quegli importi al posto
//      delle costanti: saldo di benvenuto, ricarica giornaliera (col tetto di
//      giorni accumulabili) e premi di risoluzione per priorità.
//
// PRE-CONDIZIONE del test: senza il collegamento config→motore, gli assert
// "con config diversa produce i NUOVI importi" diventano rossi (il motore
// tornerebbe 1000/100/50-100-200-300 in ogni caso).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'creditConfig.js'));
require(join(ROOT, 'src', 'main', 'services', 'creditStore.js'));

const CC = globalThis.SN_CREDIT_CONFIG;
const C = globalThis.SN_CREDITS;
const { CREDIT } = globalThis.SN_CONST;

// Config "owner" completa, con importi TUTTI diversi da quelli storici.
const OWNER = {
  initial: 2500,
  dailyRefill: 250,
  maxRefillDays: 3,
  feedbackSend: 7,
  feedbackResolveByPriority: { 0: 11, 1: 22, 2: 33, 3: 44 },
  boardVote: 15,
  boardReopen: 20,
};

// Il motore ha uno stato globale (config attiva): ogni test che la imposta la
// azzera subito dopo, così l'ordine dei test non conta.
function withActive(cfg, fn) {
  C.setActiveConfig(cfg);
  try { fn(); } finally { C.setActiveConfig(null); }
}

// ── 1. Normalizzazione della config ─────────────────────────────────────────

test('i default sono ESATTAMENTE le costanti crediti attuali', () => {
  const d = CC.defaults();
  assert.equal(d.initial, CREDIT.INITIAL);
  assert.equal(d.dailyRefill, CREDIT.DAILY_REFILL);
  assert.equal(d.maxRefillDays, CREDIT.MAX_REFILL_DAYS);
  assert.equal(d.feedbackSend, CREDIT.FEEDBACK_SEND);
  assert.equal(d.boardVote, CREDIT.BOARD_VOTE);
  assert.equal(d.boardReopen, CREDIT.BOARD_REOPEN);
  for (const p of [0, 1, 2, 3]) {
    assert.equal(d.feedbackResolveByPriority[p], CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY[p]);
  }
});

test('documento assente o non valido → tutti i default', () => {
  for (const raw of [null, undefined, 42, 'ciao', []]) {
    assert.deepEqual(CC.normalize(raw), CC.defaults());
  }
});

test('documento completo → tutti gli importi nuovi', () => {
  const c = CC.normalize(OWNER);
  assert.equal(c.initial, 2500);
  assert.equal(c.dailyRefill, 250);
  assert.equal(c.maxRefillDays, 3);
  assert.equal(c.feedbackSend, 7);
  assert.equal(c.boardVote, 15);
  assert.equal(c.boardReopen, 20);
  assert.deepEqual(c.feedbackResolveByPriority, { 0: 11, 1: 22, 2: 33, 3: 44 });
});

test('documento parziale → i campi assenti restano ai default', () => {
  const c = CC.normalize({ dailyRefill: 250 });
  assert.equal(c.dailyRefill, 250);
  assert.equal(c.initial, CREDIT.INITIAL);
  assert.equal(c.boardReopen, CREDIT.BOARD_REOPEN);
  assert.deepEqual(c.feedbackResolveByPriority, CC.defaults().feedbackResolveByPriority);
});

test('tabella per priorità parziale → solo la fascia scritta cambia', () => {
  const c = CC.normalize({ feedbackResolveByPriority: { 3: 999 } });
  assert.equal(c.feedbackResolveByPriority[3], 999);
  assert.equal(c.feedbackResolveByPriority[0], CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY[0]);
  assert.equal(c.feedbackResolveByPriority[2], CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY[2]);
});

test('valori sballati (negativi, testo, vuoto, NaN) ricadono sul default', () => {
  const c = CC.normalize({
    initial: -5,
    dailyRefill: 'tanti',
    maxRefillDays: '',
    feedbackSend: NaN,
    boardVote: null,
    boardReopen: Infinity,
    feedbackResolveByPriority: { 0: -1, 1: 'x' },
  });
  assert.equal(c.initial, CREDIT.INITIAL);
  assert.equal(c.dailyRefill, CREDIT.DAILY_REFILL);
  assert.equal(c.maxRefillDays, CREDIT.MAX_REFILL_DAYS);
  assert.equal(c.feedbackSend, CREDIT.FEEDBACK_SEND);
  assert.equal(c.boardVote, CREDIT.BOARD_VOTE);
  assert.equal(c.boardReopen, CREDIT.BOARD_REOPEN);
  assert.equal(c.feedbackResolveByPriority[0], CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY[0]);
  assert.equal(c.feedbackResolveByPriority[1], CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY[1]);
});

test('lo ZERO esplicito è rispettato (si può azzerare un premio)', () => {
  const c = CC.normalize({ feedbackSend: 0, boardVote: 0, feedbackResolveByPriority: { 2: 0 } });
  assert.equal(c.feedbackSend, 0);
  assert.equal(c.boardVote, 0);
  assert.equal(c.feedbackResolveByPriority[2], 0);
  // …e non contagia gli altri campi.
  assert.equal(c.dailyRefill, CREDIT.DAILY_REFILL);
});

// ── 2. Il motore usa la config (con config esplicita) ───────────────────────

test('saldo di benvenuto: default storico senza config, nuovo importo con config', () => {
  assert.equal(C.freshState('2026-06-17').balance, 1000);
  assert.equal(C.freshState('2026-06-17', OWNER).balance, 2500);
});

test('ricarica giornaliera: default storico senza config, nuovo importo con config', () => {
  const base = () => ({ ...C.freshState('2026-06-16'), balance: 0 });

  const senza = C.applyRefill(base(), '2026-06-17');
  assert.equal(senza.added, 100);
  assert.equal(senza.state.balance, 100);

  const con = C.applyRefill(base(), '2026-06-17', false, OWNER);
  assert.equal(con.added, 250);
  assert.equal(con.state.balance, 250);
});

test('tetto dei giorni accumulabili: usa quello della config', () => {
  const base = () => ({ ...C.freshState('2026-06-01'), balance: 0 });

  // Storico: 40 giorni mancati, tetto 30 → 30 × 100.
  const senza = C.applyRefill(base(), '2026-07-11');
  assert.equal(senza.added, 30 * 100);

  // Config: tetto 3 → 3 × 250, non 40 × 250 né 30 × 250.
  const con = C.applyRefill(base(), '2026-07-11', false, OWNER);
  assert.equal(con.added, 3 * 250);
});

test('premi di risoluzione: default storici senza config, nuovi con config', () => {
  assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p)), [50, 100, 200, 300]);
  assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p, OWNER)), [11, 22, 33, 44]);
  // Priorità fuori scala/mancante → fascia 0, anche con config.
  assert.equal(C.rewardForPriority(99, OWNER), 44);   // clamp a 3
  assert.equal(C.rewardForPriority(undefined, OWNER), 11);
});

// ── 3. Il motore usa la config REGISTRATA (quella che arriva dall'owner) ────

test('config attiva: gli importi valgono per tutte le chiamate senza parametri', () => {
  // Senza config attiva: importi storici.
  assert.equal(C.config().dailyRefill, CREDIT.DAILY_REFILL);
  assert.equal(C.config().boardReopen, CREDIT.BOARD_REOPEN);

  withActive(OWNER, () => {
    assert.equal(C.config().initial, 2500);
    assert.equal(C.config().dailyRefill, 250);
    assert.equal(C.config().feedbackSend, 7);
    assert.equal(C.config().boardVote, 15);
    assert.equal(C.config().boardReopen, 20);

    // Il motore, chiamato SENZA config esplicita, deve già usare quegli importi.
    assert.equal(C.freshState('2026-06-17').balance, 2500);
    const r = C.applyRefill({ ...C.freshState('2026-06-16'), balance: 0 }, '2026-06-17');
    assert.equal(r.added, 250);
    assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p)), [11, 22, 33, 44]);
  });

  // …e dopo averla tolta si torna esattamente agli importi storici.
  assert.equal(C.freshState('2026-06-17').balance, 1000);
  assert.deepEqual([0, 1, 2, 3].map((p) => C.rewardForPriority(p)), [50, 100, 200, 300]);
});

test('config attiva parziale/sporca: solo i campi validi cambiano, il resto resta storico', () => {
  withActive({ dailyRefill: 250, initial: -1 }, () => {
    assert.equal(C.config().dailyRefill, 250);
    assert.equal(C.config().initial, CREDIT.INITIAL);
    assert.equal(C.freshState('2026-06-17').balance, 1000);
  });
});

test('cambiare la ricarica NON ricalcola i giorni già accreditati', () => {
  // Un utente ricaricato fino a ieri con l'importo storico: oggi, col nuovo
  // importo, riceve UN solo giorno al valore NUOVO — il passato resta com'era.
  const stato = { ...C.freshState('2026-06-16'), balance: 5000 };
  withActive(OWNER, () => {
    const { state, added } = C.applyRefill(stato, '2026-06-17');
    assert.equal(added, 250);
    assert.equal(state.balance, 5250);
  });
});

test('il saldo di benvenuto NON viene riapplicato a chi ce l\'ha già', () => {
  // Stato esistente (già inizializzato): ensure/applyRefill non devono
  // rimpiazzare il saldo col nuovo "initial" della config.
  const esistente = { ...C.freshState('2026-06-17'), balance: 42 };
  withActive(OWNER, () => {
    assert.equal(C.ensure(esistente).balance, 42);
    assert.equal(C.applyRefill(esistente, '2026-06-17').state.balance, 42);
  });
});
