// Ritenzione zero coi crediti di Filo (#831): ogni richiesta pagata da Filo chiede solo host che non conservano
// domanda e risposta, insieme alla lista di esclusione; con la chiave propria dell'utente no, coi modelli Anthropic
// vale «solo dal produttore». Il «nessun host» che ne segue diventa una frase per l'utente, mai un ripiego senza vincolo.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/i18n.js');
require('../../src/shared/wallet.js');
require('../../src/shared/chatErrors.js');
require('../../src/main/services/providers/openrouter.js');
require('../../src/main/services/providers/index.js');
const C = globalThis.SN_CONST;
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const PROVIDERS = globalThis.SN_PROVIDERS;
const CE = globalThis.SN_CHAT_ERRORS;

const ROUTING = { ignore: [...C.DEFAULT_EXCLUDED_PROVIDERS] };
const MODEL = 'z-ai/glm-5.3-flash';
const KEYS = { 'sk-own': 'own', 'sk-personal': 'personal', 'sk-factory': 'factory' };

function wallet({ fallback = false } = {}) {
  return {
    keySourceOf: async (k) => KEYS[k] || '',
    alternativeKeyFor: async (k) => (fallback && k === 'sk-own' ? { key: 'sk-personal', source: 'personal' } : null),
    noteOwnKeyRefusal: async () => {},
    noteOwnKeySuccess: async () => {},
  };
}

const json = (obj, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] || null },
  clone() { return this; },
  async json() { return obj; },
  async text() { return typeof obj === 'string' ? obj : JSON.stringify(obj); },
  async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer; },
});

// `answer(url, body, key)` → risposta; ritorna l'elenco delle richieste fatte, col corpo già letto.
async function withRouter(answer, run) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const key = String((init && init.headers && init.headers.Authorization) || '').replace(/^Bearer /, '');
    calls.push({ url: String(url), body, key });
    return answer(String(url), body, key);
  };
  try { return await run(calls); } finally { global.fetch = real; }
}

const chatOk = () => json({ choices: [{ message: { content: 'ciao' } }], provider: 'DeepInfra', usage: { prompt_tokens: 1, completion_tokens: 1 } });
const sseOk = () => ({
  ok: true, status: 200, headers: { get: () => null },
  body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ciao"}}],"provider":"DeepInfra"}\n\ndata: [DONE]\n\n')); c.close(); } }),
});
const embedOk = () => json({ data: [{ index: 0, embedding: [0.1, 0.2] }], provider: 'DeepInfra' });
const sttOk = () => json({ text: 'ciao', provider: 'DeepInfra', usage: { seconds: 1 } });
const hostsOf = (...hosts) => json({ data: { endpoints: hosts.map(([provider_name, tag]) => ({ provider_name, tag })) } });

beforeEach(() => { OR.forgetModelHosts(); OR.forgetReasoningRefusals(); });
afterEach(() => { delete globalThis.SN_WALLET_MAIN; });

// Ogni tipo di richiesta, con la chiave data: il corpo che arriva al router.
async function bodiesFor(apiKey, model = MODEL) {
  const out = {};
  await withRouter((url) => {
    if (url === OR.ENDPOINT) return out.stream ? sseOk() : chatOk();
    if (url === OR.SPEECH_ENDPOINT) return json(null);
    if (url === OR.TRANSCRIPTIONS_ENDPOINT) return sttOk();
    if (url === OR.EMBEDDINGS_ENDPOINT) return embedOk();
    return json({ error: 'not found' }, 404);
  }, async (calls) => {
    const last = (u) => calls.filter((c) => c.url === u).pop().body;
    out.chat = (await OR.complete({ apiKey, model, messages: [], providerRouting: ROUTING }), last(OR.ENDPOINT));
    out.stream = true;
    out.chatStream = (await OR.streamComplete({ apiKey, model, messages: [], providerRouting: ROUTING, tools: [{ type: 'function', function: { name: 'X' } }] }), last(OR.ENDPOINT));
    out.speech = (await OR.synthesizeSpeech({ apiKey, model, text: 'ciao', providerRouting: ROUTING }), last(OR.SPEECH_ENDPOINT));
    out.transcribe = (await OR.transcribe({ apiKey, model, audioBase64: 'QUJD', providerRouting: ROUTING }), last(OR.TRANSCRIPTIONS_ENDPOINT));
    out.embed = (await OR.embed({ apiKey, model, texts: ['a'], providerRouting: ROUTING }), last(OR.EMBEDDINGS_ENDPOINT));
  });
  delete out.stream;
  return out;
}

test('coi crediti di Filo ogni tipo di richiesta chiede la ritenzione zero, insieme alla lista di esclusione', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  for (const key of ['sk-personal', 'sk-factory', 'sk-sconosciuta']) {
    const bodies = await bodiesFor(key);
    assert.deepEqual(Object.keys(bodies), ['chat', 'chatStream', 'speech', 'transcribe', 'embed']);
    for (const [kind, body] of Object.entries(bodies)) {
      assert.equal(body.provider.zdr, true, `${kind} con ${key}: manca la ritenzione zero`);
      assert.deepEqual(body.provider.ignore, ROUTING.ignore, `${kind} con ${key}: la lista di esclusione non viaggia più`);
    }
    assert.equal(bodies.chatStream.provider.require_parameters, true, 'il vincolo sugli strumenti resta');
  }
});

test('con la chiave propria dell\'utente il vincolo non c\'è: decide lui', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  for (const [kind, body] of Object.entries(await bodiesFor('sk-own'))) {
    assert.equal(body.provider.zdr, undefined, `${kind}: la chiave propria non deve portare il vincolo`);
    assert.deepEqual(body.provider.ignore, ROUTING.ignore, kind);
  }
});

test('coi modelli Anthropic vale «solo dal produttore», non la ritenzione zero', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  for (const [kind, body] of Object.entries(await bodiesFor('sk-personal', 'anthropic/claude-sonnet-4.5'))) {
    assert.equal(body.provider.zdr, undefined, kind);
    assert.deepEqual(body.provider.only, C.producerOnlyRule('anthropic/claude-sonnet-4.5').only, kind);
  }
});

test('il ripiego dalla chiave propria ai crediti porta il vincolo, perché da lì paga Filo', async () => {
  globalThis.SN_WALLET_MAIN = wallet({ fallback: true });
  await withRouter((url, body, key) => (key === 'sk-own' ? json({ error: { message: 'User not found.' } }, 401) : chatOk()), async (calls) => {
    const r = await OR.complete({ apiKey: 'sk-own', model: MODEL, messages: [], providerRouting: ROUTING });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.provider.zdr, undefined, 'con la chiave propria il vincolo non c\'era');
    assert.equal(calls[1].key, 'sk-personal');
    assert.equal(calls[1].body.provider.zdr, true, 'la stessa richiesta coi crediti porta il vincolo');
    assert.equal(r.usage.keySource, 'personal');
    assert.equal(r.servedBy, 'DeepInfra', 'la cronologia continua a sapere chi ha servito');
  });
});

const NO_HOST = { error: { message: 'No allowed providers are available for the selected model.', code: 404 } };

test('nessun host a ritenzione zero: l\'errore dice funzione e modello, non un codice tecnico', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  const endpoints = `${OR.MODELS_ENDPOINT}/${MODEL}/endpoints`;
  await withRouter((url) => (url === endpoints ? hostsOf(['DeepInfra', 'deepinfra/fp8'], ['Z.AI', 'z-ai']) : json(NO_HOST, 404)), async () => {
    await assert.rejects(OR.complete({ apiKey: 'sk-personal', model: MODEL, messages: [], providerRouting: ROUTING }), (e) => {
      assert.equal(e.code, 'NO_ZDR_HOST');
      assert.equal(e.model, MODEL);
      const frase = CE.sentence(e);
      assert.match(frase, /z-ai\/glm-5\.3-flash/);
      assert.match(frase, /non conservare domande e risposte/);
      assert.match(frase, /Modelli predefiniti/);
      assert.ok(!/404|OpenRouter \d|riprova/i.test(frase), frase);
      return true;
    });
  });
});

test('se gli host sono tutti esclusi la colpa resta della lista di esclusione, non della ritenzione zero', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  const endpoints = `${OR.MODELS_ENDPOINT}/${MODEL}/endpoints`;
  await withRouter((url) => (url === endpoints ? hostsOf(['Z.AI', 'z-ai']) : json(NO_HOST, 404)), async () => {
    await assert.rejects(OR.complete({ apiKey: 'sk-personal', model: MODEL, messages: [], providerRouting: ROUTING }), (e) => e.code === 'NO_PROVIDER_ALLOWED');
  });
});

test('la catena dei modelli di riserva non ripiega su una strada senza vincolo', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  await withRouter((url) => (url.endsWith('/endpoints') ? hostsOf(['DeepInfra', 'deepinfra']) : json(NO_HOST, 404)), async (calls) => {
    const attempts = ['z-ai/glm-5.3-flash', 'moonshotai/kimi-k3'].map((model) => ({ provider: 'openrouter', apiKey: 'sk-personal', model, providerRouting: ROUTING }));
    await assert.rejects(PROVIDERS.completeWithFallback({ attempts, messages: [] }), (e) => e.code === 'NO_ZDR_HOST');
    const chats = calls.filter((c) => c.url === OR.ENDPOINT);
    assert.equal(chats.length, 2, 'ogni modello della catena è stato provato');
    for (const c of chats) assert.equal(c.body.provider.zdr, true, `${c.body.model} è partito senza vincolo`);
  });
});

test('voce e dettatura: senza host a ritenzione zero non parte niente, e l\'errore lo spiega', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  const model = 'deepgram/aura-2';
  const zdr = { data: [{ name: 'DeepInfra | z-ai/glm-5.3-flash', provider_name: 'DeepInfra', tag: 'deepinfra' }] };
  const answer = (url) => {
    if (url === OR.ZDR_ENDPOINT) return json(zdr);
    if (url.endsWith('/endpoints')) return hostsOf(['Deepgram', 'deepgram']);
    return json(null);
  };
  await withRouter(answer, async (calls) => {
    await assert.rejects(OR.synthesizeSpeech({ apiKey: 'sk-personal', model, text: 'ciao', providerRouting: ROUTING }), (e) => {
      assert.equal(e.code, 'NO_ZDR_HOST');
      assert.match(e.message, /deepgram\/aura-2/);
      assert.match(e.message, /Non ho mandato niente/);
      return true;
    });
    await assert.rejects(OR.transcribe({ apiKey: 'sk-personal', model, audioBase64: 'QUJD', providerRouting: ROUTING }), (e) => e.code === 'NO_ZDR_HOST');
    assert.equal(calls.filter((c) => c.url === OR.SPEECH_ENDPOINT || c.url === OR.TRANSCRIPTIONS_ENDPOINT).length, 0);
    await OR.synthesizeSpeech({ apiKey: 'sk-own', model, text: 'ciao', providerRouting: ROUTING });
    assert.equal(calls.filter((c) => c.url === OR.SPEECH_ENDPOINT).length, 1, 'con la chiave propria la voce parte');
  });
});

test('il catalogo a ritenzione zero: si legge nelle forme note, e una forma ignota vale come non saputo', () => {
  const m = C.zdrCatalogFrom({ data: [
    { name: 'DeepInfra | z-ai/glm-5.3-flash', provider_name: 'DeepInfra', tag: 'deepinfra/fp8' },
    { model_id: 'Moonshotai/Kimi-K3', provider_name: 'Parasail', tag: 'parasail' },
  ] });
  assert.deepEqual(m.get('z-ai/glm-5.3-flash'), [{ name: 'DeepInfra', tag: 'deepinfra/fp8' }]);
  assert.deepEqual(m.get('moonshotai/kimi-k3'), [{ name: 'Parasail', tag: 'parasail' }]);
  assert.equal(C.zdrCatalogFrom({ data: [{ provider_name: 'X' }] }), null);
  assert.equal(C.zdrCatalogFrom(null), null);
});
