// #962 — con una chiave OpenRouter propria e l'interruttore «Con la mia chiave, usa anche i fornitori esclusi»
// acceso, le richieste pagate con lei partono senza `provider.ignore`; spento, o coi crediti di Filo (anche dopo il
// ripiego dalla chiave rifiutata, #629), la lista viaggia sempre. Fetch e tenutario delle chiavi sono finti.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/wallet.js');
require('../../src/main/services/providers/openrouter.js');
const C = globalThis.SN_CONST;
const P = globalThis.SN_PROVIDER_OPENROUTER;

const OWN = 'sk-or-v1-own';
const PERSONAL = 'sk-or-v1-personal';
const BASE = ['Google', 'OpenAI', 'xAI', 'Novita'];

// Le impostazioni effettive come le compone withDefaults (handlers.js): lista intera + quella della chiave propria.
function effettive({ toggle = false, ownKey = OWN, openWeightsOnly = false } = {}) {
  const salvate = { ownKeyAllProviders: toggle, openWeightsOnly, apiKeys: { openrouter: ownKey } };
  return {
    excludedProviders: C.effectiveExcludedProviders(BASE, openWeightsOnly),
    excludedProvidersOwnKey: C.ownKeyExcludedProviders(salvate, openWeightsOnly),
  };
}

let calls = [];
let statusFor = {};
let refusals = [];
let hostsOf = {};

beforeEach(() => {
  calls = [];
  statusFor = {};
  refusals = [];
  hostsOf = {};
  P.forgetModelHosts();
  globalThis.SN_WALLET_MAIN = {
    alternativeKeyFor: async (k) => (k === OWN ? { key: PERSONAL, source: 'personal' } : null),
    keySourceOf: async (k) => (k === OWN ? 'own' : k === PERSONAL ? 'personal' : ''),
    noteOwnKeyRefusal: async (r) => { refusals.push(r); },
  };
  globalThis.fetch = async (url, init = {}) => {
    const key = String((init.headers && init.headers.Authorization) || '').replace('Bearer ', '');
    // Il catalogo a ritenzione zero (#831): qui ogni host elencato la dichiara, la prova è sulla lista di esclusione.
    if (String(url) === P.ZDR_ENDPOINT) {
      const data = Object.entries(hostsOf).flatMap(([id, names]) => names.map((n) => ({ model_id: id, provider_name: n, tag: n.toLowerCase() })));
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    if (String(url).endsWith('/endpoints')) {
      const id = String(url).replace(`${P.MODELS_ENDPOINT}/`, '').replace('/endpoints', '');
      const endpoints = (hostsOf[id] || []).map((n) => ({ provider_name: n, tag: n.toLowerCase() }));
      return new Response(JSON.stringify({ data: { endpoints } }), { status: 200 });
    }
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, key, body });
    const status = statusFor[key] ?? 200;
    if (status !== 200) return new Response('{"error":{"message":"no"}}', { status });
    if (url === P.TRANSCRIPTIONS_ENDPOINT) return new Response(JSON.stringify({ text: 'ciao', usage: { cost: 0.001 } }), { status: 200 });
    if (url === P.EMBEDDINGS_ENDPOINT) return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }], usage: { prompt_tokens: 2 } }), { status: 200 });
    if (body && body.stream) {
      const sse = 'data: {"provider":"Google","choices":[{"delta":{"content":"ok"}}]}\n\n'
        + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({ provider: 'Google', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  };
});

const ignoreOf = (c) => (c.body && c.body.provider && c.body.provider.ignore) || null;

test('le impostazioni: la lista della chiave propria c’è solo con l’interruttore acceso E una chiave propria', () => {
  assert.equal(C.ownKeyExcludedProviders({ ownKeyAllProviders: false, apiKeys: { openrouter: OWN } }, false), null, 'spento');
  assert.equal(C.ownKeyExcludedProviders({ ownKeyAllProviders: true, apiKeys: { openrouter: '' } }, false), null, 'senza chiave');
  assert.equal(C.ownKeyExcludedProviders({ ownKeyAllProviders: true, apiKeys: { openrouter: '   ' } }, false), null, 'solo spazi');
  assert.equal(C.ownKeyExcludedProviders({ ownKeyAllProviders: 'true', apiKeys: { openrouter: OWN } }, false), null, 'solo il vero true');
  assert.deepEqual(C.ownKeyExcludedProviders({ ownKeyAllProviders: true, apiKeys: { openrouter: OWN } }, false), []);
  assert.equal(C.DEFAULT_SETTINGS.ownKeyAllProviders, false, 'spento di serie');
  // «Solo modelli a pesi aperti» resta indipendente: la sua parte della lista vale anche con la chiave propria.
  const ow = C.ownKeyExcludedProviders({ ownKeyAllProviders: true, apiKeys: { openrouter: OWN } }, true);
  assert.deepEqual(ow, C.OPEN_WEIGHTS_EXTRA_EXCLUDED);
  assert.ok(ow.includes('Anthropic'));
});

test('routing: `ownKeyIgnore` accanto alla lista intera, solo quando c’è', () => {
  assert.deepEqual(C.providerRoutingFor(effettive({ toggle: false })), { ignore: BASE });
  assert.deepEqual(C.providerRoutingFor(effettive({ toggle: true })), { ignore: BASE, ownKeyIgnore: [] });
  assert.deepEqual(C.providerRoutingFor(effettive({ toggle: true, ownKey: '' })), { ignore: BASE });
  assert.equal(C.providerRoutingFor({ excludedProviders: [] }), null);
});

test('chiave propria e interruttore acceso: niente provider.ignore; spento: la lista c’è', async () => {
  await P.complete({ apiKey: OWN, model: 'google/gemma-x', messages: [], providerRouting: C.providerRoutingFor(effettive({ toggle: true })) });
  assert.equal(ignoreOf(calls[0]), null, JSON.stringify(calls[0].body));
  calls = [];
  await P.complete({ apiKey: OWN, model: 'google/gemma-x', messages: [], providerRouting: C.providerRoutingFor(effettive({ toggle: false })) });
  assert.deepEqual(ignoreOf(calls[0]), BASE);
});

test('crediti di Filo con l’interruttore acceso: la lista c’è sempre', async () => {
  const routing = C.providerRoutingFor(effettive({ toggle: true }));
  await P.complete({ apiKey: PERSONAL, model: 'google/gemma-x', messages: [], providerRouting: routing });
  await P.streamComplete({ apiKey: PERSONAL, model: 'google/gemma-x', messages: [], providerRouting: routing });
  await P.embed({ apiKey: PERSONAL, model: 'qwen/qwen-emb', texts: ['a'], providerRouting: routing });
  assert.equal(calls.length, 3);
  for (const c of calls) assert.deepEqual(ignoreOf(c), BASE, c.url);
});

test('chiave propria rifiutata: il ripiego sui crediti riparte con la lista (chat, streaming, vettori)', async () => {
  const routing = C.providerRoutingFor(effettive({ toggle: true }));
  statusFor = { [OWN]: 401 };
  const r = await P.complete({ apiKey: OWN, model: 'qwen/qwen-x', messages: [], providerRouting: routing });
  assert.equal(r.usage.keySource, 'personal');
  const s = await P.streamComplete({ apiKey: OWN, model: 'qwen/qwen-x', messages: [], providerRouting: routing, onDelta: () => {} });
  assert.equal(s.usage.keySource, 'personal');
  const e = await P.embed({ apiKey: OWN, model: 'qwen/qwen-x', texts: ['a'], providerRouting: routing });
  assert.equal(e.usage.keySource, 'personal');
  assert.deepEqual(calls.map((c) => c.key), [OWN, PERSONAL, OWN, PERSONAL, OWN, PERSONAL]);
  for (const c of calls) {
    if (c.key === OWN) assert.equal(ignoreOf(c), null, `${c.url} con la chiave propria`);
    else assert.deepEqual(ignoreOf(c), BASE, `${c.url} coi crediti`);
  }
});

test('con gli strumenti e il ragionamento rifiutato il secondo invio dopo il ripiego tiene la lista', async () => {
  const routing = C.providerRoutingFor(effettive({ toggle: true }));
  let n = 0;
  const vero = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    n += 1;
    // Primo: chiave propria rifiutata; secondo (ripiego): «nessun host per i parametri»; terzo: senza ragionamento.
    if (n === 1) { calls.push({ url, key: OWN, body: JSON.parse(init.body) }); return new Response('{}', { status: 401 }); }
    if (n === 2) { calls.push({ url, key: PERSONAL, body: JSON.parse(init.body) }); return new Response('{"error":{"message":"No endpoints found that can handle the requested parameters"}}', { status: 404 }); }
    return vero(url, init);
  };
  const tools = [{ type: 'function', function: { name: 't', parameters: { type: 'object' } } }];
  await P.complete({ apiKey: OWN, model: 'qwen/qwen-y', messages: [], tools, reasoning: 'low', providerRouting: routing });
  assert.equal(calls.length, 3);
  assert.equal(ignoreOf(calls[0]), null);
  assert.deepEqual(ignoreOf(calls[1]), BASE);
  assert.equal(calls[2].key, PERSONAL);
  assert.deepEqual(ignoreOf(calls[2]), BASE, 'il rinvio senza ragionamento parte coi crediti: lista intera');
  assert.equal(calls[2].body.reasoning, undefined);
});

test('dettatura: con la chiave propria parte anche se la servono solo esclusi; coi crediti no', async () => {
  hostsOf['google/gemma-audio'] = ['Google Vertex'];
  const routing = C.providerRoutingFor(effettive({ toggle: true }));
  const t = await P.transcribe({ apiKey: OWN, model: 'google/gemma-audio', audioBase64: 'AA==', providerRouting: routing });
  assert.equal(t.text, 'ciao');
  assert.equal(ignoreOf(calls[0]), null);
  await assert.rejects(
    P.transcribe({ apiKey: PERSONAL, model: 'google/gemma-audio', audioBase64: 'AA==', providerRouting: routing }),
    (e) => e.code === 'NO_ALLOWED_HOST',
  );
  assert.equal(calls.length, 1, 'coi crediti la dettatura non parte');
});

test('dettatura con la chiave propria rifiutata: se i crediti non ammettono chi la serve, niente ripiego', async () => {
  hostsOf['google/gemma-audio'] = ['Google Vertex'];
  const routing = C.providerRoutingFor(effettive({ toggle: true }));
  statusFor = { [OWN]: 401 };
  await assert.rejects(
    P.transcribe({ apiKey: OWN, model: 'google/gemma-audio', audioBase64: 'AA==', providerRouting: routing }),
    (e) => e.status === 401 && e.keySource === 'own' && !e.keyFallback,
  );
  assert.deepEqual(calls.map((c) => c.key), [OWN], 'la personale non parte');
  assert.equal(refusals.length, 1, 'il rifiuto resta in Crediti');
  assert.equal(refusals[0].served, false);
  // Un modello che i crediti ammettono ripiega come sempre, con la lista.
  calls = []; refusals = [];
  hostsOf['qwen/qwen-stt'] = ['Groq'];
  const t = await P.transcribe({ apiKey: OWN, model: 'qwen/qwen-stt', audioBase64: 'AA==', providerRouting: routing });
  assert.equal(t.usage.keySource, 'personal');
  assert.deepEqual(calls.map((c) => c.key), [OWN, PERSONAL]);
  assert.deepEqual(ignoreOf(calls[1]), BASE);
});

test('chi ha servito: con la chiave propria a interruttore acceso non è una violazione; coi crediti sì', () => {
  const on = effettive({ toggle: true });
  assert.equal(C.servedViolationOf(on, { servedBy: 'Google Vertex', model: 'google/gemma-x', usage: { keySource: 'own' } }), '');
  assert.equal(C.servedViolationOf(on, { servedBy: 'Google Vertex', model: 'google/gemma-x', keySource: 'own' }), '', 'voce: keySource in cima');
  assert.equal(C.servedViolationOf(on, { servedBy: 'Google Vertex', model: 'google/gemma-x', usage: { keySource: 'personal' } }), 'excluded', 'dopo il ripiego');
  assert.equal(C.servedViolationOf(effettive({ toggle: false }), { servedBy: 'Google', model: 'g', usage: { keySource: 'own' } }), 'excluded', 'spento');
  // «Solo pesi aperti» vale comunque: Anthropic resta fuori anche con la chiave propria.
  const ow = effettive({ toggle: true, openWeightsOnly: true });
  assert.equal(C.servedViolationOf(ow, { servedBy: 'Anthropic', model: 'x/y', usage: { keySource: 'own' } }), 'excluded');
  assert.equal(C.servedViolationOf(ow, { servedBy: 'Google', model: 'x/y', usage: { keySource: 'own' } }), '');
});

test('il cancello giudica chi ha servito con la chiave che ha pagato', async () => {
  require('../../src/main/services/modelGate.js');
  const fake = {
    synthesizeSpeech: async () => ({ audioBase64: 'AA==', servedBy: 'Google', keySource: 'own', usage: { costUsd: 0.001, keySource: 'own' } }),
  };
  globalThis.SN_PROVIDERS = { getProvider: () => fake };
  const gate = globalThis.SN_MODEL_GATE.create({
    getSettings: async () => effettive({ toggle: true }),
    costs: { isOverLimit: async () => false, record: async () => 0 },
  });
  const a = { provider: 'openrouter', apiKey: OWN, model: 'google/tts' };
  const r = await gate.call({ action: 'tts', attempt: a, method: 'synthesizeSpeech', args: { text: 'ciao' } });
  assert.equal(r.servedBy, 'Google', 'chi ha servito resta registrato');
  assert.equal(r.violation, false);
  fake.synthesizeSpeech = async () => ({ audioBase64: 'AA==', servedBy: 'Google', keySource: 'personal', usage: { costUsd: 0.001, keySource: 'personal' } });
  const r2 = await gate.call({ action: 'tts', attempt: a, method: 'synthesizeSpeech', args: { text: 'ciao' } });
  assert.equal(r2.violation, true);
});

test('nessun host ammesso con la chiave propria a interruttore spento: la frase dice anche di accenderlo', () => {
  require('../../src/shared/chatErrors.js');
  const CE = globalThis.SN_CHAT_ERRORS;
  const err = { keySource: 'own' };
  const spento = CE.rimedioNessunHost('opzioni', err, effettive({ toggle: false }));
  assert.match(spento, /Opzioni → Modelli per azione\./);
  assert.match(spento, /«Con la mia chiave, usa anche i fornitori esclusi» in Opzioni/);
  assert.equal(CE.rimedioNessunHost('opzioni', { keySource: 'personal' }, effettive({ toggle: false })), CE.RIMEDI_NESSUN_HOST.opzioni, 'coi crediti no');
  assert.equal(CE.rimedioNessunHost('predefiniti', err, effettive({ toggle: true, openWeightsOnly: true })), CE.RIMEDI_NESSUN_HOST.predefiniti, 'già acceso');
});
