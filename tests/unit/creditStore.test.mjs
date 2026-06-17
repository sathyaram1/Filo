// Unit test per src/main/services/creditStore.js — il motore crediti (C1).
// Testa SOLO la logica PURA (nessun chrome.storage / Electron): refill mezzanotte
// multi-giorno, conversione costo€→crediti, aggregazione per tipo d'uso, vista
// pubblica senza costo €, ricompense.

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

test('si registra su globalThis con la sua API pura', () => {
  assert.ok(C);
  for (const fn of ['freshState', 'applyRefill', 'costEurToCredits', 'applyConsumption', 'applyAward', 'publicView']) {
    assert.equal(typeof C[fn], 'function', `manca ${fn}`);
  }
});

test('saldo iniziale = 1000', () => {
  const s = C.freshState('2026-06-17');
  assert.equal(s.balance, CREDIT.INITIAL);
  assert.equal(s.balance, 1000);
  assert.equal(s.lastRefillDate, '2026-06-17');
});

test('refill: stesso giorno → nessun accredito', () => {
  const s = C.freshState('2026-06-17');
  const { state, added } = C.applyRefill(s, '2026-06-17');
  assert.equal(added, 0);
  assert.equal(state.balance, 1000);
});

test('refill: +100 a mezzanotte (un giorno)', () => {
  const s = C.freshState('2026-06-16');
  const { state, added } = C.applyRefill(s, '2026-06-17');
  assert.equal(added, 100);
  assert.equal(state.balance, 1100);
  assert.equal(state.lastRefillDate, '2026-06-17');
});

test('refill MULTI-GIORNO: 3 giorni saltati → +300 in una volta', () => {
  const s = C.freshState('2026-06-14');
  const { state, added } = C.applyRefill(s, '2026-06-17');
  assert.equal(added, 300);
  assert.equal(state.balance, 1300);
});

test('refill: tetto anti-abuso a MAX_REFILL_DAYS', () => {
  const s = C.freshState('2026-01-01');
  const { added } = C.applyRefill(s, '2026-12-31'); // ~364 giorni
  assert.equal(added, CREDIT.MAX_REFILL_DAYS * CREDIT.DAILY_REFILL);
  assert.equal(added, 30 * 100);
});

test('refill: applicato due volte nello stesso giorno non raddoppia', () => {
  let s = C.freshState('2026-06-16');
  s = C.applyRefill(s, '2026-06-17').state;
  const { added } = C.applyRefill(s, '2026-06-17');
  assert.equal(added, 0);
});

test('conversione costo€ → crediti (1 credito = 0,0008€)', () => {
  assert.equal(C.costEurToCredits(0.0008), 1);
  assert.equal(C.costEurToCredits(0.008), 10);
  assert.equal(C.costEurToCredits(0), 0);
  assert.equal(C.costEurToCredits(-5), 0);
});

test('consumo: scala il saldo dei crediti corrispondenti al costo', () => {
  const s = C.freshState('2026-06-17');
  const { state, credits } = C.applyConsumption(s, { action: 'spellcheck_word', costEur: 0.0008 });
  assert.equal(credits, 1);
  assert.equal(state.balance, 999);
});

test('consumo: il saldo non scende sotto zero', () => {
  let s = C.freshState('2026-06-17');
  s.balance = 0.5;
  const { state } = C.applyConsumption(s, { action: 'filo_chat', costEur: 0.008 }); // 10 crediti
  assert.equal(state.balance, 0);
});

test('aggregazione PER USO (non per modello): word+semantic → "Correttore ortografico"', () => {
  let s = C.freshState('2026-06-17');
  s = C.applyConsumption(s, { action: 'spellcheck_word', costEur: 0.0008 }).state;
  s = C.applyConsumption(s, { action: 'spellcheck_semantic', costEur: 0.0008 }).state;
  assert.ok(s.byUsage['Correttore ortografico']);
  assert.equal(s.byUsage['Correttore ortografico'].credits, 2);
  assert.equal(s.byUsage['Correttore ortografico'].calls, 2);
});

test('aggregazione: azioni diverse in gruppi distinti', () => {
  let s = C.freshState('2026-06-17');
  s = C.applyConsumption(s, { action: 'filo_tab_triage', costEur: 0.0008 }).state;
  s = C.applyConsumption(s, { action: 'translate_page', costEur: 0.0008 }).state;
  assert.equal(s.byUsage['Gestione schede'].credits, 1);
  assert.equal(s.byUsage['Traduzione'].credits, 1);
});

test('azione non mappata → gruppo "Altro"', () => {
  let s = C.freshState('2026-06-17');
  s = C.applyConsumption(s, { action: 'azione_sconosciuta', costEur: 0.0008 }).state;
  assert.equal(s.byUsage['Altro'].credits, 1);
});

test('il costo € è tracciato dietro le quinte ma NON nella vista pubblica', () => {
  let s = C.freshState('2026-06-17');
  s = C.applyConsumption(s, { action: 'filo_chat', costEur: 0.0016 }).state;
  // dietro le quinte
  assert.ok(s.totalCostEur > 0);
  assert.ok(s.byAction['filo_chat'].costEur > 0);
  // vista pubblica: niente costo €
  const pub = C.publicView(s);
  assert.equal(pub.totalCostEur, undefined);
  assert.equal(pub.byAction, undefined);
  assert.ok(pub.byUsage['Chat con Filo']);
  assert.equal('costEur' in pub.byUsage['Chat con Filo'], false);
});

test('ricompensa: accredita e logga, anti doppio-premio per feedback risolto', () => {
  let s = C.freshState('2026-06-17');
  s = C.applyAward(s, { kind: 'feedback_sent', credits: 5 }).state;
  assert.equal(s.balance, 1005);
  assert.equal(s.rewards.length, 1);
  s = C.applyAward(s, { kind: 'feedback_resolved', credits: 200, ref: 'fb123' }).state;
  assert.equal(s.balance, 1205);
  assert.equal(s.rewardedFeedback['fb123'], true);
});

test('ricompensa per priorità: la tabella è 50/100/200/300', () => {
  assert.deepEqual(CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY, { 0: 50, 1: 100, 2: 200, 3: 300 });
});

test('rewardForPriority: mappa la priorità sulla fascia di crediti (C5)', () => {
  assert.equal(C.rewardForPriority(0), 50);
  assert.equal(C.rewardForPriority(1), 100);
  assert.equal(C.rewardForPriority(2), 200);
  assert.equal(C.rewardForPriority(3), 300);
});

test('rewardForPriority: priorità mancante/fuori scala → fascia 0 (50)', () => {
  assert.equal(C.rewardForPriority(undefined), 50);
  assert.equal(C.rewardForPriority(null), 50);
  assert.equal(C.rewardForPriority(7), 300);   // clamp alto
  assert.equal(C.rewardForPriority(-3), 50);    // clamp basso
  assert.equal(C.rewardForPriority('2'), 200);  // stringa numerica
});
