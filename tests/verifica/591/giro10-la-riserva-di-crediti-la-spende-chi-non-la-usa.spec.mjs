// Verifica #591 — giro 10. La riserva di crediti la spende anche chi non la
// sta usando.
//
// Stessa causa del caso qui accanto: il conteggio che vive dentro il cancello
// unico non guarda con QUALE chiave è partita la chiamata. La pagina Crediti
// promette all'utente che ha messo la propria chiave: «ogni chiamata prova
// prima lei; se OpenRouter la rifiuta, Filo usa i tuoi crediti». I crediti sono
// quindi la RISERVA per il giorno in cui la chiave propria smette di
// rispondere. Ogni chiamata servita dalla chiave propria la consuma lo stesso,
// quindi la riserva si svuota proprio mentre nessuno la sta usando.
//
// Logica pura: nessun fornitore, nessuna rete.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
require_(join(REPO, 'src/shared/constants.js'));

function fresco(rel) {
  const p = join(REPO, rel);
  delete require_.cache[require_.resolve(p)];
  return require_(p);
}

function memoria() {
  const dati = {};
  globalThis.chrome = {
    storage: { local: {
      async get(k) { return { [k]: dati[k] }; },
      async set(o) { Object.assign(dati, o); },
    } },
  };
  fresco('src/main/services/creditStore.js');
  fresco('src/main/services/costTracker.js');
  return { Costs: globalThis.SN_COSTS, Credits: globalThis.SN_CREDITS };
}

async function chiamate(Costs, keySource, quante = 400) {
  for (let i = 0; i < quante; i++) {
    await Costs.record({
      action: 'filo_chat', provider: 'openrouter', model: 'deepseek/deepseek-v4-flash',
      usage: { promptTokens: 6000, completionTokens: 1200, keySource },
      pricing: null, usdToEur: 0.92,
    });
  }
}

test('caso di riscontro: le chiamate che usano la riserva la consumano', async () => {
  const { Costs, Credits } = memoria();
  const prima = (await Credits.getPublic()).balanceExact;
  await chiamate(Costs, 'personal');
  const dopo = (await Credits.getPublic()).balanceExact;
  expect(dopo, 'servite dalla chiave dei crediti, la riserva deve calare').toBeLessThan(prima);
});

test('le chiamate servite dalla chiave propria non devono intaccare la riserva', async () => {
  const { Costs, Credits } = memoria();
  const prima = (await Credits.getPublic()).balanceExact;
  await chiamate(Costs, 'own');
  const dopo = (await Credits.getPublic()).balanceExact;
  expect(
    dopo,
    `la riserva è scesa da ${prima.toFixed(1)} a ${dopo.toFixed(1)} per chiamate pagate dall'utente `
    + 'con la sua chiave: quando quella chiave verrà rifiutata, la riserva promessa non ci sarà più',
  ).toBe(prima);
});
