// #904: un modello anthropic/ chiesto a OpenRouter va solo agli host di Anthropic, e chi ha servito
// da un altro host (Amazon Bedrock, Azure) è una violazione, su tutte le strade del cancello.

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
require('../../src/main/services/providers/openrouter.js');
require('../../src/main/services/costTracker.js');
require('../../src/main/services/modelGate.js');

const C = globalThis.SN_CONST;
const OpenRouter = globalThis.SN_PROVIDER_OPENROUTER;
const GATE = globalThis.SN_MODEL_GATE;
const { ACTIONS, STORAGE_KEYS } = C;
const CLAUDE = 'anthropic/claude-haiku-4.5';
const SOLO_ANTHROPIC = ['anthropic', 'claude-on-aws'];

function jsonResponse(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj), headers: { get: () => null } };
}
function sseResponse(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true, status: 200, text: async () => '', headers: { get: () => null },
    body: { getReader: () => ({ read: () => Promise.resolve(i >= chunks.length ? { done: true } : { done: false, value: enc.encode(chunks[i++]) }) }) },
  };
}
async function bodyOf(run) {
  const orig = global.fetch;
  let sent = null;
  global.fetch = (url, opts) => {
    sent = JSON.parse(opts.body);
    return Promise.resolve(url.includes('chat/completions') && sent.stream
      ? sseResponse(['data: ' + JSON.stringify({ provider: 'Anthropic', choices: [{ delta: { content: 'ok' } }] }) + '\n\n', 'data: [DONE]\n\n'])
      : jsonResponse({ choices: [{ message: { content: 'ok' } }], provider: 'Anthropic', usage: {}, data: [{ embedding: [0.1] }] }));
  };
  try { await run(); } finally { global.fetch = orig; }
  return sent;
}

test('Claude via OpenRouter: la richiesta può andare solo agli host di Anthropic, anche senza lista di esclusione', async () => {
  const msgs = [{ role: 'user', content: 'ciao' }];
  const conLista = await bodyOf(() => OpenRouter.complete({
    apiKey: 'k', model: CLAUDE, messages: msgs, providerRouting: { ignore: ['Google', 'OpenAI'], sort: 'latency' },
  }));
  assert.deepEqual(conLista.provider.only, SOLO_ANTHROPIC);
  assert.deepEqual(conLista.provider.ignore, ['Google', 'OpenAI'], 'la lista di esclusione resta');
  assert.equal(conLista.provider.sort, 'latency');

  const senzaLista = await bodyOf(() => OpenRouter.complete({ apiKey: 'k', model: CLAUDE, messages: msgs }));
  assert.deepEqual(senzaLista.provider, { only: SOLO_ANTHROPIC });

  const inStreaming = await bodyOf(() => OpenRouter.streamComplete({ apiKey: 'k', model: 'Anthropic/Claude-Sonnet-4.5:thinking', messages: msgs, onDelta: () => {} }));
  assert.deepEqual(inStreaming.provider.only, SOLO_ANTHROPIC, 'maiuscole e varianti con i due punti sono lo stesso modello');

  const indicizzazione = await bodyOf(() => OpenRouter.embed({ apiKey: 'k', model: CLAUDE, texts: ['a'] }));
  assert.deepEqual(indicizzazione.provider.only, SOLO_ANTHROPIC);
});

test('un modello non di Anthropic non viene legato a un host', async () => {
  const sent = await bodyOf(() => OpenRouter.complete({
    apiKey: 'k', model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: 'x' }], providerRouting: { ignore: ['DeepSeek'] },
  }));
  assert.equal(sent.provider.only, undefined);
  assert.equal(C.producerOnlyRule('mistralai/anthropic-like'), null);
  assert.equal(C.producerOnlyRule(''), null);
  assert.equal(C.producerOnlyRule(null), null);
});

test('chi ha servito: un host diverso da Anthropic su un modello anthropic/ è una violazione', () => {
  const esclusi = ['Google', 'Novita'];
  for (const host of ['Amazon Bedrock', 'Azure', 'Google Vertex']) {
    assert.ok(C.servedPolicyViolation(host, CLAUDE, esclusi), `${host} su Claude`);
  }
  assert.equal(C.servedPolicyViolation('Amazon Bedrock', CLAUDE, esclusi), 'not-producer');
  assert.equal(C.servedPolicyViolation('Google Vertex', CLAUDE, esclusi), 'excluded');
  assert.equal(C.servedPolicyViolation('Anthropic', CLAUDE, esclusi), '');
  assert.equal(C.servedPolicyViolation('Claude Platform on AWS', CLAUDE, esclusi), '', 'gestito da Anthropic: ammesso');
  assert.equal(C.servedPolicyViolation('Amazon Bedrock', 'meta-llama/llama-4', esclusi), '', 'i pesi aperti li può servire chiunque non sia escluso');
  assert.equal(C.servedPolicyViolation('Novita', 'meta-llama/llama-4', esclusi), 'excluded');
  assert.equal(C.servedPolicyViolation(null, CLAUDE, esclusi), '', 'chi ha servito non si sa: niente da dire');
});

test('con «solo pesi aperti» anche gli host di Anthropic sono esclusi', () => {
  const acceso = C.effectiveExcludedProviders([], true);
  assert.equal(C.isProviderExcluded('Anthropic', acceso), true);
  assert.equal(C.isProviderExcluded('Claude Platform on AWS', acceso), true);
});

let impostazioni;
let risposta;
let tardi;

function cancello() {
  const fornitore = {
    transcribe: async () => ({ text: 'ciao', servedBy: 'Azure', usage: { costUsd: 0.001 } }),
    synthesizeSpeech: async () => ({ audioBase64: 'AAAA', generationId: 'gen-1', keyUsed: 'k' }),
    lookupServedBy: async () => ({ servedBy: 'Amazon Bedrock', costUsd: 0.002 }),
  };
  globalThis.SN_PROVIDERS = {
    completeWithFallback: async ({ attempts }) => ({ ...risposta, provider: attempts[0].provider, model: attempts[0].model }),
    getProvider: (nome) => (nome === 'openrouter' ? fornitore : null),
  };
  return GATE.create({
    getSettings: async () => impostazioni,
    buildChain: () => [{ provider: 'openrouter', apiKey: 'k', model: CLAUDE }],
    modelFor: () => 'claude-haiku',
    costs: globalThis.SN_COSTS,
    auditDelaysMs: [0],
  });
}

beforeEach(() => {
  delete memoria[STORAGE_KEYS.COSTS];
  impostazioni = { monthlyLimitEur: 0, usdToEur: 1, pricing: {}, excludedProviders: ['Google'] };
  risposta = { text: 'ok', servedBy: 'Amazon Bedrock', usage: { costUsd: 0.0004 } };
  tardi = null;
});

test('il cancello marca Claude servito da Amazon: in catena, in una chiamata singola e quando chi ha servito si sa dopo', async () => {
  const Gate = cancello();
  const r = await Gate.complete({ action: ACTIONS.FILO_CHAT, messages: [] });
  assert.equal(r.servedBy, 'Amazon Bedrock');
  assert.equal(r.violation, true);

  risposta.servedBy = 'Anthropic';
  assert.equal((await Gate.complete({ action: ACTIONS.FILO_CHAT, messages: [] })).violation, false);

  const attempt = { provider: 'openrouter', apiKey: 'k', model: CLAUDE };
  const dettatura = await Gate.call({ action: ACTIONS.TRANSCRIBE_AUDIO, attempt, method: 'transcribe', args: {} });
  assert.equal(dettatura.violation, true);

  await Gate.call({ action: ACTIONS.TTS, attempt, method: 'synthesizeSpeech', args: { text: 'x' }, onLateServedBy: (x) => { tardi = x; } });
  for (let i = 0; i < 50 && !tardi; i++) await new Promise((ok) => setTimeout(ok, 5));
  assert.deepEqual(tardi, { servedBy: 'Amazon Bedrock', violation: true });
});
