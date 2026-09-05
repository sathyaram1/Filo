// Unit test per il conteggio crediti sulle chiamate AI (costTracker.record →
// creditStore.recordConsumption). Regressione del bug "ho usato crediti ma NON
// sono scesi": col setup di default quasi tutte le chiamate passano da Gemini
// (servite gratis → costo € = 0), quindi PRIMA del fix i crediti non calavano
// mai. Il fix usa un prezzo NOZIONALE per i crediti, lasciando il limite di
// spesa REALE a 0 sulle chiamate gratuite.
//
// Precondizione (diventa RED senza fix): una chiamata servita da Gemini con
// `pricing: null` deve far SCENDERE il saldo crediti. Senza il prezzo nozionale
// il saldo resterebbe 1000.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'main', 'services', 'creditStore.js'));
require(join(ROOT, 'src', 'main', 'services', 'costTracker.js'));

const { STORAGE_KEYS, ACTIONS } = globalThis.SN_CONST;
const Costs = globalThis.SN_COSTS;
const Credits = globalThis.SN_CREDITS;

// Shim chrome.storage.local minimale (get/set su un oggetto in memoria), fresco
// per ogni test così i saldi non si trascinano tra i casi.
function installStorage() {
  const backing = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: backing[key] }; },
        async set(obj) { Object.assign(backing, obj); },
      },
    },
  };
  return backing;
}

async function balance() {
  return (await Credits.getPublic()).balanceExact;
}

test('notionalPricingFor: prezzo di listino per i modelli predefiniti', () => {
  const p = globalThis.SN_CONST.notionalPricingFor('deepseek/deepseek-v4-flash');
  assert.ok(p && p.input > 0 && p.output > 0, 'deepseek/deepseek-v4-flash deve avere un prezzo nozionale');
  assert.equal(globalThis.SN_CONST.notionalPricingFor('modello-sconosciuto'), null);
});

test('chiamata servita da Gemini (pricing null) → i crediti SCENDONO', async () => {
  installStorage();
  const before = await balance();
  assert.equal(before, 1000, 'saldo iniziale');

  // Come nei call site reali quando `usedProvider === 'gemini'`: pricing = null.
  await Costs.record({
    action: ACTIONS.EXPLAIN,
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    usage: { promptTokens: 4000, completionTokens: 2000 },
    pricing: null,
    usdToEur: 0.92,
  });

  const after = await balance();
  assert.ok(after < before, `il saldo deve scendere (prima ${before}, dopo ${after})`);
});

test('il limite di spesa REALE resta a 0 sulle chiamate Gemini gratuite', async () => {
  installStorage();
  const eur = await Costs.record({
    action: ACTIONS.FILO_CHAT,
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    usage: { promptTokens: 4000, completionTokens: 2000 },
    pricing: null,
    usdToEur: 0.92,
  });
  assert.equal(eur, 0, 'la spesa reale di una chiamata gratuita è 0');
  const m = await Costs.getMonthly();
  assert.equal(m.totalEur, 0, 'il budget mensile in euro non conta le chiamate gratuite');
  // …ma i crediti sì.
  assert.ok((await balance()) < 1000, 'i crediti scendono comunque');
});

test('chiamata OpenRouter con prezzo reale: crediti E budget scendono (nessuna regressione)', async () => {
  installStorage();
  const eur = await Costs.record({
    action: ACTIONS.EDIT_TEXT,
    provider: 'openrouter',
    model: 'anthropic/claude-3.5-haiku',
    usage: { promptTokens: 4000, completionTokens: 2000 },
    pricing: { input: 0.80, output: 4.00 },
    usdToEur: 0.92,
  });
  assert.ok(eur > 0, 'una chiamata OpenRouter a pagamento ha costo reale > 0');
  assert.ok((await balance()) < 1000, 'i crediti scendono');
});

test('modello personalizzato senza listino: ripiego → crediti comunque scesi', async () => {
  installStorage();
  await Costs.record({
    action: ACTIONS.FILO_CHAT,
    provider: 'openrouter',
    model: 'un/modello-custom-senza-prezzo',
    usage: { promptTokens: 4000, completionTokens: 2000 },
    pricing: null,
    usdToEur: 0.92,
  });
  assert.ok((await balance()) < 1000, 'anche senza listino noto una chiamata reale costa crediti');
});
