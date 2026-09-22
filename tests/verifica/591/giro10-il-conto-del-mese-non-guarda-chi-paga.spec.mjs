// Verifica #591 — giro 10. Il conto del mese non guarda CHI ha pagato.
//
// Il tetto mensile è l'unico fondo vero di tutto questo lavoro, e nasce da una
// frase precisa della segnalazione: «con le chiavi condivise di fabbrica paga
// l'owner». Chi porta la PROPRIA chiave OpenRouter (la pagina Crediti la
// chiede, e promette che ogni chiamata prova prima quella) paga di tasca sua:
// quella spesa all'owner non costa niente. Il conto del mese la somma lo
// stesso, e quando la somma tocca il tetto — cinque euro di serie — il cancello
// unico ferma TUTTO, chat compresa.
//
// La domanda giusta il codice la sa già fare: il registro d'uso sul server
// scrive la riga solo per le chiamate servite dalla chiave che paga l'owner, e
// il fornitore dice a ogni risposta da dove veniva la chiave. Qui nessuno la
// chiede.
//
// Logica pura: fornitore finto, nessuna rete.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));

function fresco(rel) {
  const p = join(REPO, rel);
  delete require_.cache[require_.resolve(p)];
  return require_(p);
}

require_(join(REPO, 'src/shared/constants.js'));
const Gate = require_(join(REPO, 'src/main/services/modelGate.js'));
const ROUTER = 'src/main/services/providers/index.js';

// chrome.storage.local in memoria, fresco a ogni caso.
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
  return globalThis.SN_COSTS;
}

// Un mese di uso normale: sei dollari e mezzo di chiamate, tutte servite dalla
// chiave indicata. `own` è la chiave scritta dall'utente, `personal` quella che
// paga l'owner.
async function mese(Costs, keySource) {
  for (let i = 0; i < 13; i++) {
    await Costs.record({
      action: 'filo_chat', provider: 'openrouter', model: 'modello-x',
      usage: { promptTokens: 4000, completionTokens: 800, costUsd: 0.5, keySource },
      pricing: null, usdToEur: 0.92,
    });
  }
}

test('caso di riscontro: la spesa che paga l\'owner riempie il tetto', async () => {
  const Costs = memoria();
  await mese(Costs, 'personal');
  expect(
    await Costs.isOverLimit(5),
    'le chiamate servite dalla chiave che paga l\'owner devono riempire il tetto',
  ).toBe(true);
});

test('la spesa fatta con la chiave dell\'utente non deve riempire il tetto', async () => {
  const Costs = memoria();
  await mese(Costs, 'own');
  const m = await Costs.getMonthly();
  expect(
    await Costs.isOverLimit(5),
    `l'utente ha speso ${m.totalEur.toFixed(2)}€ di tasca sua con la sua chiave, e il conto del mese `
    + 'li ha messi sul tetto che protegge l\'owner: da qui in avanti Filo si ferma per una spesa '
    + 'che all\'owner non è costata niente',
  ).toBe(false);
});

test('con la propria chiave la chat deve continuare a rispondere', async () => {
  const Costs = memoria();
  await mese(Costs, 'own');

  globalThis.SN_PROVIDER_FINTO = {
    async complete() {
      return { text: 'risposta', usage: { promptTokens: 10, completionTokens: 5, costUsd: 0.001, keySource: 'own' }, servedBy: 'finto' };
    },
  };
  Gate.configure({
    modelForAction: () => 'modello-finto',
    buildAttemptChain: () => ([{ provider: 'finto', apiKey: 'chiave-dell-utente', model: 'modello-finto' }]),
    noteServedProvider: () => ({ servedBy: 'finto', violation: false }),
  });

  let testo = null;
  let errore = null;
  try {
    const r = await Gate.complete({
      settings: { monthlyLimitEur: 5, usdToEur: 0.92, pricing: {} },
      action: 'filo_chat', messages: [{ role: 'user', content: 'ciao' }],
    });
    testo = r.text;
  } catch (e) { errore = e; }

  expect(
    testo,
    'dopo sei euro spesi con la PROPRIA chiave la chat deve ancora rispondere; oggi il cancello '
    + `la ferma con «${errore && errore.message}»`,
  ).toBe('risposta');
});
