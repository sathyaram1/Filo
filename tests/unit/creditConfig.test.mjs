// Unit test per gli importi crediti configurabili dall'owner (#366.2).
//
// Copre due pezzi, entrambi logica PURA (niente Electron / Firestore):
//   1. SN_CREDIT_CONFIG (src/shared/creditConfig.js): defaults == costanti CREDIT,
//      normalize() di un doc grezzo (parziale / invalido / con tabella priorità).
//   2. SN_CREDITS (creditStore.js) che LEGGE quegli importi come parametro:
//      freshState/applyRefill/rewardForPriority producono i NUOVI importi con una
//      config, e ancora quelli STORICI senza config (fallback CREDIT). È il
//      criterio di "fatto" della parte 2: togliendo il passaggio della config, gli
//      assert sui nuovi importi diventano rossi.

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

const CFG = globalThis.SN_CREDIT_CONFIG;
const C = globalThis.SN_CREDITS;
const { CREDIT } = globalThis.SN_CONST;

// Una config owner d'esempio con importi TUTTI diversi da quelli storici.
const CUSTOM = {
  initial: 5000,
  dailyRefill: 250,
  maxRefillDays: 10,
  feedbackSend: 20,
  feedbackResolveByPriority: { 0: 111, 1: 222, 2: 333, 3: 444 },
  boardVote: 40,
  boardReopen: 15,
};

// ── SN_CREDIT_CONFIG ─────────────────────────────────────────────────────────

test('SN_CREDIT_CONFIG si registra con defaults/normalize', () => {
  assert.ok(CFG);
  assert.equal(typeof CFG.defaults, 'function');
  assert.equal(typeof CFG.normalize, 'function');
});

test('defaults() == ESATTAMENTE le costanti CREDIT correnti', () => {
  const d = CFG.defaults();
  assert.equal(d.initial, CREDIT.INITIAL);
  assert.equal(d.dailyRefill, CREDIT.DAILY_REFILL);
  assert.equal(d.maxRefillDays, CREDIT.MAX_REFILL_DAYS);
  assert.equal(d.feedbackSend, CREDIT.FEEDBACK_SEND);
  assert.equal(d.boardVote, CREDIT.BOARD_VOTE);
  assert.equal(d.boardReopen, CREDIT.BOARD_REOPEN);
  assert.deepEqual(d.feedbackResolveByPriority, { 0: 50, 1: 100, 2: 200, 3: 300 });
});

test('normalize(null/undefined/non-oggetto) → tutti i default', () => {
  assert.deepEqual(CFG.normalize(null), CFG.defaults());
  assert.deepEqual(CFG.normalize(undefined), CFG.defaults());
  assert.deepEqual(CFG.normalize('x'), CFG.defaults());
});

test('normalize(parziale) → i campi presenti vincono, il resto default', () => {
  const n = CFG.normalize({ dailyRefill: 250, initial: 5000 });
  assert.equal(n.dailyRefill, 250);
  assert.equal(n.initial, 5000);
  // Non specificati → default CREDIT.
  assert.equal(n.feedbackSend, CREDIT.FEEDBACK_SEND);
  assert.equal(n.boardVote, CREDIT.BOARD_VOTE);
  assert.deepEqual(n.feedbackResolveByPriority, { 0: 50, 1: 100, 2: 200, 3: 300 });
});

test('normalize: valori invalidi/negativi ricadono sul default (mai importi rotti)', () => {
  const n = CFG.normalize({ dailyRefill: -5, initial: 'abc', boardVote: null, boardReopen: NaN });
  assert.equal(n.dailyRefill, CREDIT.DAILY_REFILL);
  assert.equal(n.initial, CREDIT.INITIAL);
  assert.equal(n.boardVote, CREDIT.BOARD_VOTE);
  assert.equal(n.boardReopen, CREDIT.BOARD_REOPEN);
});

test('normalize: tabella priorità parziale/invalida → fasce mancanti dal default', () => {
  const n = CFG.normalize({ feedbackResolveByPriority: { 1: 999, 2: -1 } });
  assert.equal(n.feedbackResolveByPriority[0], 50);   // assente → storico
  assert.equal(n.feedbackResolveByPriority[1], 999);  // valido → override
  assert.equal(n.feedbackResolveByPriority[2], 200);  // negativo → storico
  assert.equal(n.feedbackResolveByPriority[3], 300);  // assente → storico
});

// ── Il motore LEGGE la config (parametro esplicito) ──────────────────────────

test('freshState(config): saldo iniziale = config.initial (non 1000)', () => {
  const s = C.freshState('2026-06-17', CUSTOM);
  assert.equal(s.balance, 5000);
  // Senza config resta lo storico 1000.
  assert.equal(C.freshState('2026-06-17').balance, CREDIT.INITIAL);
});

test('applyRefill(config): +dailyRefill della config per ogni mezzanotte', () => {
  const s = C.freshState('2026-06-16', CUSTOM);
  const { state, added } = C.applyRefill(s, '2026-06-17', false, CUSTOM);
  assert.equal(added, 250);            // config.dailyRefill, non 100
  assert.equal(state.balance, 5250);   // 5000 + 250
});

test('applyRefill(config): tetto a config.maxRefillDays con config.dailyRefill', () => {
  const s = C.freshState('2026-01-01', CUSTOM);
  const { added } = C.applyRefill(s, '2026-12-31', false, CUSTOM); // ~364 giorni
  assert.equal(added, CUSTOM.maxRefillDays * CUSTOM.dailyRefill); // 10 * 250 = 2500
});

test('rewardForPriority(priority, config): usa la tabella della config', () => {
  assert.equal(C.rewardForPriority(0, CUSTOM), 111);
  assert.equal(C.rewardForPriority(1, CUSTOM), 222);
  assert.equal(C.rewardForPriority(2, CUSTOM), 333);
  assert.equal(C.rewardForPriority(3, CUSTOM), 444);
  // Senza config resta la tabella storica.
  assert.equal(C.rewardForPriority(2), 200);
});

// ── FALLBACK: senza config, comportamento IDENTICO a prima di #366.2 ─────────

test('nessuna config (né esplicita né attiva) → importi storici', () => {
  C.setActiveConfig(null);
  assert.equal(C.freshState('2026-06-17').balance, 1000);
  assert.equal(C.applyRefill(C.freshState('2026-06-16'), '2026-06-17').added, 100);
  assert.equal(C.rewardForPriority(3), 300);
});

// ── Config ATTIVA (quella che l'handler registra dopo aver letto Firestore) ──

test('setActiveConfig: i wrapper senza parametro usano la config attiva', () => {
  C.setActiveConfig(CUSTOM);
  // config() = config effettiva risolta (usata per feedbackSend/boardVote/boardReopen).
  assert.equal(C.config().feedbackSend, 20);
  assert.equal(C.config().boardVote, 40);
  assert.equal(C.config().boardReopen, 15);
  // Anche le funzioni pure SENZA parametro esplicito ora vedono la config attiva.
  assert.equal(C.freshState('2026-06-17').balance, 5000);
  assert.equal(C.rewardForPriority(1), 222);
  // Reset per non contaminare altri test nel processo.
  C.setActiveConfig(null);
  assert.equal(C.freshState('2026-06-17').balance, 1000);
});

test('config attiva PARZIALE: i campi mancanti ricadono sul default CREDIT', () => {
  C.setActiveConfig({ dailyRefill: 250 }); // solo dailyRefill
  assert.equal(C.applyRefill(C.freshState('2026-06-16'), '2026-06-17').added, 250);
  assert.equal(C.freshState('2026-06-17').balance, CREDIT.INITIAL); // initial non toccato → storico
  assert.equal(C.rewardForPriority(0), 50);                          // tabella non toccata → storica
  C.setActiveConfig(null);
});

test('config esplicita VINCE sulla config attiva', () => {
  C.setActiveConfig(CUSTOM);
  // Passando una config diversa al volo, quella esplicita ha la precedenza.
  assert.equal(C.freshState('2026-06-17', { initial: 77 }).balance, 77);
  C.setActiveConfig(null);
});
