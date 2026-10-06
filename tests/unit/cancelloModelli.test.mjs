// Il cancello dei modelli (#591): oltre il limite di spesa nessuna chiamata parte, e quelle che partono finiscono nel
// conteggio dei costi. Qui col conteggio vero (costTracker) e i due chiamanti di servizio che prima lo saltavano:
// il riconoscimento del blocco geografico e il giudice anti-phishing. La regola sui file la tiene la sentinella.

import { test, beforeEach } from 'node:test';
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
require('../../src/main/services/costTracker.js');
require('../../src/main/services/modelGate.js');
const Classifier = require('../../src/main/services/geoBlockClassifier.js');
const Giudice = require('../../src/main/services/safebrowse/llm.js');

const { ACTIONS, STORAGE_KEYS } = globalThis.SN_CONST;
const Costs = globalThis.SN_COSTS;
const GATE = globalThis.SN_MODEL_GATE;

const CATENA = [{ provider: 'openrouter', apiKey: 'k-prova', model: 'deepseek/deepseek-v4-flash' }];
const PAGINA_AMBIGUA = { title: 'Forbidden', text: 'Access denied', statusCode: 403, host: 'video.esempio.it', url: 'https://video.esempio.it/v/1' };

let impostazioni;
let chiamate;
let risposta;

function fornitoreFinto() {
  const fornitore = {
    synthesizeSpeech: async () => { chiamate.push('synthesizeSpeech'); return { audioBase64: 'AAAA', mimeType: 'audio/pcm', generationId: 'gen-1', keyUsed: 'k-prova', keySource: 'factory' }; },
    lookupServedBy: async () => ({ servedBy: 'Kokoro Host', costUsd: 0.002 }),
  };
  globalThis.SN_PROVIDERS = {
    completeWithFallback: async ({ attempts, messages }) => {
      chiamate.push(messages);
      return { ...risposta, provider: attempts[0].provider, model: attempts[0].model };
    },
    streamCompleteWithFallback: async ({ attempts, messages, onDelta }) => {
      chiamate.push(messages);
      if (onDelta) onDelta(risposta.text);
      return { ...risposta, provider: attempts[0].provider, model: attempts[0].model };
    },
    getProvider: (nome) => (nome === 'openrouter' ? fornitore : null),
  };
}

function cancello(extra = {}) {
  return GATE.create({
    getSettings: async () => impostazioni,
    buildChain: () => CATENA.map((a) => ({ ...a })),
    modelFor: () => 'deepseek-flash',
    costs: Costs,
    auditDelaysMs: [0],
    ...extra,
  });
}

async function spesaGiaOltre(limite) {
  impostazioni.monthlyLimitEur = limite;
  await Costs.record({ action: ACTIONS.FILO_CHAT, provider: 'openrouter', model: 'x', usage: { costUsd: limite + 1 }, usdToEur: 1 });
}

const speso = async (azione) => ((await Costs.getMonthly()).byAction[azione] || 0);

beforeEach(() => {
  delete memoria[STORAGE_KEYS.COSTS];
  impostazioni = { monthlyLimitEur: 5, usdToEur: 1, pricing: {}, excludedProviders: [] };
  chiamate = [];
  risposta = { text: 'geo_block', servedBy: 'DeepInfra', usage: { promptTokens: 180, completionTokens: 3, costUsd: 0.0004 } };
  fornitoreFinto();
});

test('blocco geografico con il limite di spesa esaurito: la chiamata viene rifiutata e non parte', async () => {
  await spesaGiaOltre(5);
  const Gate = cancello();
  const cache = Classifier.createCache();
  const complete = ({ messages, signal }) => Gate.text({ action: ACTIONS.GEOBLOCK_CLASSIFY, messages, signal });
  const r = await Classifier.classify(PAGINA_AMBIGUA, { complete, cache });
  assert.equal(r.code, 'LIMIT_REACHED');
  assert.equal(r.route.proxy, false);
  assert.equal(chiamate.length, 0, 'nessuna chiamata al fornitore');
  assert.equal(await speso(ACTIONS.GEOBLOCK_CLASSIFY), 0);
  // Il rifiuto non si ricorda: alzato il limite la pagina va classificata davvero.
  assert.equal(cache.size, 0);
  impostazioni.monthlyLimitEur = 50;
  const dopo = await Classifier.classify(PAGINA_AMBIGUA, { complete, cache });
  assert.equal(dopo.class, 'geo_block');
  assert.equal(chiamate.length, 1);
});

test('blocco geografico sotto il limite: la chiamata parte e il suo costo entra nel conteggio del mese', async () => {
  const Gate = cancello();
  const r = await Classifier.classify(PAGINA_AMBIGUA, {
    complete: ({ messages, signal }) => Gate.text({ action: ACTIONS.GEOBLOCK_CLASSIFY, messages, signal }),
    cache: Classifier.createCache(),
  });
  assert.equal(r.class, 'geo_block');
  assert.equal(chiamate.length, 1);
  const eur = await speso(ACTIONS.GEOBLOCK_CLASSIFY);
  assert.ok(Math.abs(eur - 0.0004) < 1e-9, `costo registrato: ${eur}`);
  assert.ok((await Costs.getMonthly()).totalEur >= 0.0004);
});

test('giudice anti-phishing: oltre il limite non chiama il modello, sotto il limite lo chiama e conta il costo', async () => {
  const Gate = cancello();
  const runLlm = (messages) => Gate.text({ action: ACTIONS.SAFEBROWSE_JUDGE, messages });
  const meta = { host: 'paypa1-login.esempio.xyz', registrable: 'esempio.xyz', secure: false };
  risposta = { text: '{"suspicious":true,"reason":"brand_mimic","confidence":"high"}', usage: { promptTokens: 300, completionTokens: 20, costUsd: 0.0002 } };

  await spesaGiaOltre(5);
  assert.equal(await Giudice.judge(meta, runLlm), null);
  assert.equal(chiamate.length, 0);

  impostazioni.monthlyLimitEur = 0; // nessun limite
  const v = await Giudice.judge(meta, runLlm);
  assert.equal(v.suspicious, true);
  assert.equal(chiamate.length, 1);
  assert.ok(await speso(ACTIONS.SAFEBROWSE_JUDGE) > 0);
});

test('in diretta come a risposta intera: oltre il limite il cancello rifiuta prima di aprire lo stream', async () => {
  await spesaGiaOltre(1);
  const Gate = cancello();
  await assert.rejects(Gate.stream({ action: ACTIONS.FILO_CHAT, messages: [{ role: 'user', content: 'ciao' }] }), { code: 'LIMIT_REACHED' });
  await assert.rejects(Gate.complete({ action: ACTIONS.FILO_CHAT, messages: [] }), { code: 'LIMIT_REACHED' });
  assert.equal(chiamate.length, 0);
});

test('chi ha servito torna col risultato e un fornitore escluso è marcato', async () => {
  impostazioni.excludedProviders = ['DeepInfra'];
  const r = await cancello().complete({ action: ACTIONS.FILO_CHAT, messages: [] });
  assert.equal(r.servedBy, 'DeepInfra');
  assert.equal(r.violation, true);
  assert.ok(r.costEur > 0);
});

test('voce: oltre il limite non parte; sotto il limite costo e chi ha servito arrivano dopo, dalla generazione', async () => {
  const Gate = cancello();
  const tentativo = { ...CATENA[0] };
  await spesaGiaOltre(2);
  await assert.rejects(Gate.call({ action: ACTIONS.TTS, attempt: tentativo, method: 'synthesizeSpeech', args: { text: 'ciao' } }), { code: 'LIMIT_REACHED' });
  assert.equal(chiamate.length, 0);

  impostazioni.monthlyLimitEur = 0;
  let tardi = null;
  const r = await Gate.call({
    action: ACTIONS.TTS, attempt: tentativo, method: 'synthesizeSpeech', args: { text: 'ciao' },
    onLateServedBy: (x) => { tardi = x; },
  });
  assert.equal(r.audioBase64, 'AAAA');
  assert.deepEqual(chiamate, ['synthesizeSpeech']);
  for (let i = 0; i < 50 && !tardi; i++) await new Promise((ok) => setTimeout(ok, 5));
  assert.deepEqual(tardi, { servedBy: 'Kokoro Host', violation: false });
  assert.ok(Math.abs(await speso(ACTIONS.TTS) - 0.002) < 1e-9);
});

test('il cancello fa passare solo le chiamate che fanno lavorare un modello', async () => {
  await assert.rejects(cancello().call({ action: ACTIONS.TTS, attempt: CATENA[0], method: 'keyInfo' }), { code: 'GATE_METHOD' });
  assert.equal(GATE.supports('openrouter', 'synthesizeSpeech'), true);
  assert.equal(GATE.hasProvider('inesistente'), false);
});
