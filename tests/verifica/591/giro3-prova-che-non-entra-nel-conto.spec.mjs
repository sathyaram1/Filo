// Verifica #591 — giro 3. La prova di un modello che non è di testo arriva al
// fornitore, si paga, e non entra in nessun conto.
//
// La segnalazione chiede un passaggio obbligato «con dentro limite di spesa,
// conteggio dei costi e registrazione di chi ha servito». Il pulsante «Prova»
// accanto a un modello ci passa: col mese esaurito non parte (verificato nei
// giri scorsi). Ma il conteggio del costo arriva solo quando la risposta del
// fornitore risale col suo consumo, e per i modelli che non sono di testo —
// voce, dettatura, indicizzazione — la risposta viene riconfezionata per la
// pagina (quanti byte di audio, quante dimensioni del vettore) e il consumo
// resta per strada. Il fornitore invece lo dice: la sua risposta porta i
// token e il costo.
//
// Risultato: chi prova un modello di voce o di indicizzazione paga sulla
// chiave — condivisa, quindi dell'owner — e quella spesa non compare nella
// pagina dei costi né nel totale del mese. La prova di un modello di TESTO,
// sulla stessa pagina e con lo stesso pulsante, li registra entrambi: sono due
// strade equivalenti che si comportano in modo diverso.
//
// Niente Electron, niente rete: l'handler vero con fornitore e conteggio finti.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));

require_(join(REPO, 'src/shared/constants.js'));
require_(join(REPO, 'tests/fixtures/testModels.js'));
require_(join(REPO, 'src/shared/messages.js'));
require_(join(REPO, 'src/shared/modelCaps.js'));
const { MSG } = globalThis.SN_MSG;

const Gate = require_(join(REPO, 'src/main/services/modelGate.js'));
const registerAi = require_(join(REPO, 'src/main/services/handlers/ai.js'));

const stato = {
  defaults: { modelRegistry: {}, apiKeys: {} },
  effective: { modelRegistry: {}, apiKeys: {}, usdToEur: 0.92, monthlyLimitEur: 5 },
  chiamate: [],
  costi: [],
};

globalThis.SN_PROVIDERS = {
  getProvider: () => ({
    // Il fornitore dice sempre quanto è costata la chiamata.
    streamComplete: async ({ onDelta }) => {
      stato.chiamate.push('testo');
      onDelta('1, 2, 3');
      return { usage: { promptTokens: 12, completionTokens: 7, costUsd: 0.0004 } };
    },
    embed: async () => {
      stato.chiamate.push('indicizzazione');
      return { vectors: [[0.1, 0.2, 0.3]], usage: { promptTokens: 4, costUsd: 0.0002 } };
    },
  }),
};

globalThis.SN_COSTS = {
  isOverLimit: async () => false,
  record: async (r) => { stato.costi.push(r); return 0.0002; },
};

Gate.configure({
  modelForAction: () => '',
  buildAttemptChain: () => [],
  providerRouting: () => null,
  noteServedProvider: () => ({ servedBy: null, violation: false }),
});

const handlers = new Map();
registerAi((tipo, fn) => handlers.set(tipo, fn), {
  MSG,
  getEffectiveSettings: async () => stato.effective,
  Defaults: { refreshIfStale: async () => stato.defaults, get: () => stato.defaults },
  isAdmin: () => true,
  handleAIRequest: async () => ({}),
  modelForAction: () => '',
  buildAttemptChain: () => [],
  openWeightsBlockReason: () => null,
  providerRouting: () => null,
});

const provaModello = (msg) => handlers.get(MSG.TEST_DEFAULT_MODEL)(msg);

function azzera() { stato.chiamate = []; stato.costi = []; }

test('caso di riscontro: la prova di un modello di testo entra nel conto', async () => {
  azzera();
  stato.defaults = {
    modelRegistry: { 'scrivi': { provider: 'openrouter', model: 'un/modello-di-testo' } },
    apiKeys: { openrouter: 'sk-or-finta' },
  };
  const res = await provaModello({ nickname: 'scrivi' });
  expect(res.ok, `atteso ok, ottenuto: ${res.error}`).toBe(true);
  expect(stato.chiamate).toEqual(['testo']);
  expect(stato.costi.length, 'la prova di un modello di testo scrive una riga di spesa').toBe(1);
});

test('la prova di un modello di indicizzazione si paga ma non entra nel conto', async () => {
  azzera();
  stato.defaults = {
    modelRegistry: {
      'indicizza': {
        provider: 'openrouter', model: 'un/modello-di-vettori',
        inputs: ['text'], outputs: ['embedding'],
      },
    },
    apiKeys: { openrouter: 'sk-or-finta' },
  };
  const res = await provaModello({ nickname: 'indicizza' });
  expect(res.ok, `atteso ok, ottenuto: ${res.error}`).toBe(true);
  expect(stato.chiamate, 'la chiamata al fornitore è partita davvero').toEqual(['indicizzazione']);
  expect(stato.costi.length,
    'il fornitore ha detto quanto è costata: quella spesa deve comparire nel conto del mese, come per un modello di testo')
    .toBe(1);
});
