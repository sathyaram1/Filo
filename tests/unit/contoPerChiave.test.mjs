// Il conto del mese guarda con quale chiave è partita la chiamata (#591).
//
// Il tetto mensile difende chi paga le chiavi condivise. Chi scrive la propria
// chiave OpenRouter paga di tasca sua: quella spesa non deve riempire il tetto
// (a cinque euro Filo si spegneva tutto, chat compresa) né scalare i crediti,
// che la pagina Crediti promette come riserva per quando quella chiave viene
// rifiutata. Senza il campo che dice da dove veniva la chiave si conta come
// prima: il dubbio cade dalla parte di chi il tetto lo protegge.

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

const Costs = globalThis.SN_COSTS;
const Credits = globalThis.SN_CREDITS;

function memoria() {
  const dati = {};
  globalThis.chrome = {
    storage: { local: {
      async get(k) { return { [k]: dati[k] }; },
      async set(o) { Object.assign(dati, o); },
    } },
  };
}

async function spendi(keySource, quante = 10) {
  for (let i = 0; i < quante; i++) {
    await Costs.record({
      action: 'filo_chat', provider: 'openrouter', model: 'deepseek/deepseek-v4-flash',
      usage: { promptTokens: 4000, completionTokens: 800, costUsd: 0.5, keySource },
      pricing: null, usdToEur: 0.92,
    });
  }
}

test('la spesa fatta con la chiave dell\'utente non riempie il tetto', async () => {
  memoria();
  await spendi('own');
  assert.equal(await Costs.isOverLimit(5), false, 'cinque euro di soldi suoi non chiudono Filo');
  const m = await Costs.getMonthly();
  assert.equal(m.totalEur, 0, 'il tetto conta solo chi paga le chiavi condivise');
  assert.ok(m.proprieEur > 4, 'quella spesa resta visibile, in una somma sua');
});

test('la spesa che pagano le chiavi condivise riempie il tetto', async () => {
  memoria();
  await spendi('personal');
  assert.equal(await Costs.isOverLimit(5), true);
  const m = await Costs.getMonthly();
  assert.ok(m.totalEur > 4);
  assert.equal(m.proprieEur, 0);
});

test('senza il campo della chiave si conta come prima', async () => {
  memoria();
  await spendi(undefined);
  assert.equal(await Costs.isOverLimit(5), true, 'nel dubbio il tetto scatta');
});

test('i crediti sono la riserva: la chiave propria non li scala', async () => {
  memoria();
  const prima = (await Credits.getPublic()).balanceExact;
  await spendi('own', 200);
  assert.equal((await Credits.getPublic()).balanceExact, prima);
});

test('i crediti scendono per le chiamate che li usano davvero', async () => {
  memoria();
  const prima = (await Credits.getPublic()).balanceExact;
  await spendi('personal', 200);
  assert.ok((await Credits.getPublic()).balanceExact < prima);
});
