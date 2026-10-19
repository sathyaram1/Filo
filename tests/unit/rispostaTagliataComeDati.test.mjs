// #1097.3 giro 1 — chi legge la risposta come dati (un'etichetta, un JSON, la memoria riscritta) non riceve mai un pezzo
// tagliato: dal tetto o da un errore a metà flusso arriva un errore che lo dice. Chi la mostra a una persona la riceve con la riga.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const memoria = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => ({ [k]: memoria[k] }),
      set: async (o) => { Object.assign(memoria, JSON.parse(JSON.stringify(o))); },
    },
  },
};
require('../../src/shared/constants.js');
require('../../src/shared/chatErrors.js');
require('../../src/main/services/costTracker.js');
require('../../src/main/services/modelGate.js');

const { ACTIONS } = globalThis.SN_CONST;
const CE = globalThis.SN_CHAT_ERRORS;
let risposta;
globalThis.SN_PROVIDERS = {
  completeWithFallback: async ({ attempts }) => ({ ...risposta, provider: attempts[0].provider, model: attempts[0].model }),
  getProvider: () => null,
};
const Gate = globalThis.SN_MODEL_GATE.create({
  getSettings: async () => ({ monthlyLimitEur: 50, usdToEur: 1, pricing: {}, excludedProviders: [] }),
  buildChain: () => [{ provider: 'openrouter', apiKey: 'k', model: 'deepseek/deepseek-v4-flash' }],
  modelFor: () => 'deepseek-flash',
  costs: globalThis.SN_COSTS,
  auditDelaysMs: [0],
});

test('una risposta tagliata dal tetto o da un errore non arriva come testo a chi la legge come dati', async () => {
  risposta = { text: '{"decisions":[{"id":1', finishReason: 'length', usage: {} };
  await assert.rejects(Gate.text({ action: ACTIONS.FILE_NAME, messages: [] }), (e) => e.code === 'RISPOSTA_TAGLIATA' && /Preferenze/.test(CE.sentence(e)));
  risposta = { text: 'mezza', finishReason: 'error', usage: {} };
  await assert.rejects(Gate.text({ action: ACTIONS.FILE_NAME, messages: [] }), (e) => e.code === 'RISPOSTA_TAGLIATA' && CE.rimedio(e) === '');
  risposta = { text: 'intera', finishReason: 'stop', usage: {} };
  assert.equal(await Gate.text({ action: ACTIONS.FILE_NAME, messages: [] }), 'intera');
});

test('chi la mostra la riceve con la riga che lo dice, e il seguito si chiede con le stesse parole ovunque', () => {
  assert.equal(CE.troncata('length'), true);
  assert.equal(CE.troncata('error'), true);
  assert.equal(CE.troncata('stop'), false);
  assert.equal(CE.troncata(null), false);
  assert.match(CE.rispostaInterrotta('error'), /si è fermato a metà/);
  assert.equal(CE.eFraseInterrotta(` ${CE.rispostaInterrotta('length')} `), true);
  assert.equal(CE.eFraseInterrotta('Le tappe del viaggio'), false);
  assert.match(CE.CHIEDI_SEGUITO, /^Continua da dove ti sei interrotto/);
});
