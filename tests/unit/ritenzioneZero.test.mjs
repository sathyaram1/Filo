// Ritenzione zero coi crediti di Filo (#831): ogni richiesta pagata da Filo chiede solo host che non conservano
// domanda e risposta, insieme alla lista di esclusione; con la chiave propria dell'utente no, coi modelli Anthropic
// vale «solo dal produttore». Il «nessun host» che ne segue è la frase di #828, mai un ripiego senza vincolo.

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
require('../../src/main/services/modelGate.js');
const C = globalThis.SN_CONST;
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const CE = globalThis.SN_CHAT_ERRORS;

const ROUTING = { ignore: [...C.DEFAULT_EXCLUDED_PROVIDERS] };
const MODEL = 'z-ai/glm-5.3-flash';
const CLAUDE = 'anthropic/claude-sonnet-4.5';
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

// Il router finto: `hosts` modello → [[nome, tag]]; `zdr` modello → [[nome, tag]] (null: il catalogo non risponde).
const HOSTS = { [MODEL]: [['DeepInfra', 'deepinfra/fp8'], ['Z.AI', 'z-ai']], [CLAUDE]: [['Anthropic', 'anthropic']], 'moonshotai/kimi-k3': [['Parasail', 'parasail']] };
const ZDR = { [MODEL]: [['DeepInfra', 'deepinfra/fp8']], 'moonshotai/kimi-k3': [['Parasail', 'parasail']] };
async function withRouter({ hosts = HOSTS, zdr = ZDR, answer }, run) {
  const real = global.fetch;
  const calls = [];
  OR.forgetModelHosts();
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u === OR.ZDR_ENDPOINT) {
      calls.push({ url: u });
      if (!zdr) return json({ error: 'boom' }, 500);
      // Il catalogo vero non è mai vuoto: un modello qualunque c'è sempre.
      return json({ data: Object.entries({ 'altro/modello': [['Altro', 'altro']], ...zdr }).flatMap(([id, list]) => list.map(([provider_name, tag]) => ({ name: `${provider_name} | ${id}`, provider_name, tag }))) });
    }
    if (u.endsWith('/endpoints')) {
      const model = decodeURIComponent(u.slice(`${OR.MODELS_ENDPOINT}/`.length, -'/endpoints'.length));
      calls.push({ url: u });
      const h = hosts[model];
      return h ? json({ data: { endpoints: h.map(([provider_name, tag]) => ({ provider_name, tag, supported_parameters: ['tools'] })) } }) : json({ error: 'not found' }, 404);
    }
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const key = String((init && init.headers && init.headers.Authorization) || '').replace(/^Bearer /, '');
    calls.push({ url: u, body, key });
    return answer(u, body, key);
  };
  try { return await run(calls); } finally { global.fetch = real; }
}

const chatOk = () => json({ choices: [{ message: { content: 'ciao' } }], provider: 'DeepInfra', usage: { prompt_tokens: 1, completion_tokens: 1 } });
const sseOk = () => ({
  ok: true, status: 200, headers: { get: () => null },
  body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ciao"}}],"provider":"DeepInfra"}\n\ndata: [DONE]\n\n')); c.close(); } }),
});
const okFor = (url, body) => {
  if (url === OR.ENDPOINT) return body && body.stream ? sseOk() : chatOk();
  if (url === OR.SPEECH_ENDPOINT) return json(null);
  if (url === OR.TRANSCRIPTIONS_ENDPOINT) return json({ text: 'ciao', provider: 'DeepInfra', usage: { seconds: 1 } });
  if (url === OR.EMBEDDINGS_ENDPOINT) return json({ data: [{ index: 0, embedding: [0.1, 0.2] }], provider: 'DeepInfra' });
  return json({ error: 'not found' }, 404);
};

beforeEach(() => { OR.forgetModelHosts(); OR.forgetReasoningRefusals(); });
afterEach(() => { delete globalThis.SN_WALLET_MAIN; });

// Ogni tipo di richiesta, con la chiave data: il corpo che arriva al router.
async function bodiesFor(apiKey, model = MODEL) {
  const hosts = { ...HOSTS, [MODEL]: [['DeepInfra', 'deepinfra/fp8']] };
  return withRouter({ hosts, answer: okFor }, async (calls) => {
    const last = (u) => calls.filter((c) => c.url === u).pop().body;
    const out = {};
    const tools = [{ type: 'function', function: { name: 'X' } }];
    await OR.complete({ apiKey, model, messages: [], providerRouting: ROUTING }); out.chat = last(OR.ENDPOINT);
    await OR.streamComplete({ apiKey, model, messages: [], providerRouting: ROUTING, tools }); out.chatStream = last(OR.ENDPOINT);
    await OR.synthesizeSpeech({ apiKey, model, text: 'ciao', providerRouting: ROUTING }); out.speech = last(OR.SPEECH_ENDPOINT);
    await OR.transcribe({ apiKey, model, audioBase64: 'QUJD', providerRouting: ROUTING }); out.transcribe = last(OR.TRANSCRIPTIONS_ENDPOINT);
    await OR.embed({ apiKey, model, texts: ['a'], providerRouting: ROUTING }); out.embed = last(OR.EMBEDDINGS_ENDPOINT);
    return out;
  });
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
  for (const [kind, body] of Object.entries(await bodiesFor('sk-personal', CLAUDE))) {
    assert.equal(body.provider.zdr, undefined, kind);
    assert.deepEqual(body.provider.only, C.producerOnlyRule(CLAUDE).only, kind);
  }
});

test('il ripiego dalla chiave propria ai crediti porta il vincolo, perché da lì paga Filo', async () => {
  globalThis.SN_WALLET_MAIN = wallet({ fallback: true });
  const answer = (url, body, key) => (key === 'sk-own' ? json({ error: { message: 'User not found.' } }, 401) : chatOk());
  await withRouter({ answer }, async (calls) => {
    const r = await OR.complete({ apiKey: 'sk-own', model: MODEL, messages: [], providerRouting: ROUTING });
    const chats = calls.filter((c) => c.url === OR.ENDPOINT);
    assert.equal(chats.length, 2);
    assert.equal(chats[0].body.provider.zdr, undefined, 'con la chiave propria il vincolo non c\'era');
    assert.equal(chats[1].key, 'sk-personal');
    assert.equal(chats[1].body.provider.zdr, true, 'la stessa richiesta coi crediti porta il vincolo');
    assert.equal(r.usage.keySource, 'personal');
    assert.equal(r.servedBy, 'DeepInfra', 'la cronologia continua a sapere chi ha servito');
  });
});

const NO_HOST = { error: { message: 'No allowed providers are available for the selected model.', code: 404 } };
const noHost = (url, body) => (url === OR.ENDPOINT ? json(NO_HOST, 404) : okFor(url, body));
// Il router vero: risponde se un host ammesso e a ritenzione zero c'è, se no il suo 404.
const routerVero = (zdr = ZDR) => (url, body) => {
  if (url !== OR.ENDPOINT) return okFor(url, body);
  const ok = (zdr[body.model] || []).some(([name, tag]) => !C.hostPolicyViolation({ name, tag }, body.model, body.provider.ignore || []));
  return ok ? okFor(url, body) : json(NO_HOST, 404);
};

function cancello() {
  return globalThis.SN_MODEL_GATE.create({
    getSettings: async () => ({ useDefaultModels: false }),
    buildChain: () => [],
    modelFor: () => '',
    costs: { isOverLimit: async () => false, record: async () => 0 },
    funzioneDi: () => 'Spiega (inline)',
    rimedioDi: () => CE.RIMEDI_NESSUN_HOST.opzioni,
  });
}
const tentativo = (model, apiKey = 'sk-personal') => ({ provider: 'openrouter', apiKey, model, providerRouting: ROUTING });
const fallita = (p) => p.then(() => assert.fail('la richiesta doveva fallire'), (e) => e);

test('nessun host ammesso a ritenzione zero: la frase condivisa con funzione, modello, motivo e rimedio', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  const zdr = { [MODEL]: [['Z.AI', 'z-ai']] };
  for (const via of ['complete', 'stream']) {
    const err = await withRouter({ zdr, answer: routerVero(zdr) }, () => fallita(cancello()[via]({
      action: 'explain', attempts: [tentativo(MODEL)], messages: [], ...(via === 'stream' ? { onDelta: () => {} } : {}),
    })));
    assert.equal(err.code, 'NO_ALLOWED_HOST', via);
    assert.equal(err.reason, 'zdr');
    const frase = CE.sentence(CE.fromResponse({ error: err.message, code: err.code, status: err.status, provider: err.provider }));
    assert.equal(frase, 'La funzione «Spiega (inline)» non può usare «z-ai/glm-5.3-flash» perché nessun fornitore ammesso lo ospita senza conservare i dati, e coi crediti di Filo è una condizione. Scegline un altro in Opzioni → Modelli per azione.');
    assert.equal(CE.rimedio({ code: err.code }), 'opzioni');
  }
});

test('il rifiuto che nomina la ritenzione zero basta anche senza catalogo', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  const testo = { error: { message: 'No endpoints found matching your data policy (Zero data retention).', code: 404 } };
  const err = await withRouter({ zdr: null, answer: (u, b) => (u === OR.ENDPOINT ? json(testo, 404) : okFor(u, b)) }, () => fallita(OR.complete({ apiKey: 'sk-personal', model: MODEL, messages: [], providerRouting: ROUTING })));
  assert.equal(err.code, 'NO_ALLOWED_HOST');
  assert.equal(err.reason, 'zdr');
  assert.match(err.message, /non può usare «z-ai\/glm-5\.3-flash» perché nessun fornitore ammesso lo ospita senza conservare i dati/);
});

test('se a mancare non è la ritenzione zero, il codice resta quello del router', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  // Host a ritenzione zero ammessi ci sono: il 404 ha un'altra causa.
  const altro = await withRouter({ answer: noHost }, () => fallita(OR.complete({ apiKey: 'sk-personal', model: MODEL, messages: [], providerRouting: ROUTING })));
  assert.equal(altro.code, 'NO_PROVIDER_ALLOWED');
  // Catalogo che non risponde e un rifiuto che non la nomina: non si inventa il caso.
  const ignoto = await withRouter({ zdr: null, answer: noHost }, () => fallita(OR.complete({ apiKey: 'sk-personal', model: MODEL, messages: [], providerRouting: ROUTING })));
  assert.equal(ignoto.code, 'NO_PROVIDER_ALLOWED');
  // Con la chiave propria il vincolo non c'era: il catalogo non si chiede nemmeno.
  const proprio = await withRouter({ zdr: {}, answer: noHost }, async (calls) => {
    const e = await fallita(OR.complete({ apiKey: 'sk-own', model: MODEL, messages: [], providerRouting: ROUTING }));
    assert.equal(calls.filter((c) => c.url === OR.ZDR_ENDPOINT).length, 0);
    return e;
  });
  assert.equal(proprio.code, 'NO_PROVIDER_ALLOWED');
  // Tutti gli host esclusi: la colpa è della lista di esclusione (#828), non della ritenzione zero.
  const esclusi = await withRouter({ hosts: { [MODEL]: [['Z.AI', 'z-ai']] }, zdr: {}, answer: noHost }, () => fallita(OR.complete({ apiKey: 'sk-personal', model: MODEL, messages: [], providerRouting: ROUTING })));
  assert.equal(esclusi.code, 'NO_ALLOWED_HOST');
  assert.equal(esclusi.reason, 'excluded');
});

test('la catena dei modelli di riserva non ripiega su una strada senza vincolo', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  const zdr = {};
  await withRouter({ zdr, answer: routerVero(zdr) }, async (calls) => {
    const err = await fallita(cancello().complete({ action: 'explain', attempts: [tentativo(MODEL), tentativo('moonshotai/kimi-k3')], messages: [] }));
    assert.equal(err.code, 'NO_ALLOWED_HOST');
    assert.equal(err.reason, 'zdr');
    const chats = calls.filter((c) => c.url === OR.ENDPOINT);
    assert.deepEqual(chats.map((c) => c.body.model), [MODEL, 'moonshotai/kimi-k3'], 'ogni modello della catena è stato provato');
    for (const c of chats) assert.equal(c.body.provider.zdr, true, `${c.body.model} è partito senza vincolo`);
  });
});

test('voce e dettatura coi crediti: partono solo se tutti gli host dichiarano la ritenzione zero', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  const model = 'hexgrad/kokoro-82m';
  const hosts = { [model]: [['DeepInfra', 'deepinfra'], ['Together', 'together']] };
  const audio = (calls) => calls.filter((c) => c.url === OR.SPEECH_ENDPOINT || c.url === OR.TRANSCRIPTIONS_ENDPOINT).length;
  const casi = [
    [{}, 'zdr', /lo servono solo DeepInfra e Together, che non si impegnano a non conservare/],
    [{ [model]: [['DeepInfra', 'deepinfra']] }, 'zdrmixed', /lo serve anche Together, che non si impegna a non conservare/],
    [null, 'zdrunknown', /^Non so quali fornitori del modello «hexgrad\/kokoro-82m» si impegnano/],
  ];
  for (const [zdr, reason, frase] of casi) {
    await withRouter({ hosts, zdr, answer: okFor }, async (calls) => {
      for (const p of [
        OR.synthesizeSpeech({ apiKey: 'sk-personal', model, text: 'ciao', providerRouting: ROUTING }),
        OR.transcribe({ apiKey: 'sk-personal', model, audioBase64: 'QUJD', providerRouting: ROUTING }),
      ]) {
        const e = await fallita(p);
        assert.equal(e.code, 'NO_ALLOWED_HOST', reason);
        assert.equal(e.reason, reason);
        assert.match(e.message, frase);
        assert.match(e.message, /Non ho mandato niente|non ho mandato niente/);
      }
      assert.equal(audio(calls), 0, `${reason}: non è partito niente`);
      // Con la chiave propria il vincolo non c'è: la voce parte.
      await OR.synthesizeSpeech({ apiKey: 'sk-own', model, text: 'ciao', providerRouting: ROUTING });
      assert.equal(audio(calls), 1, 'con la chiave propria la voce parte');
    });
  }
  await withRouter({ hosts, zdr: { [model]: hosts[model] }, answer: okFor }, async (calls) => {
    await OR.synthesizeSpeech({ apiKey: 'sk-personal', model, text: 'ciao', providerRouting: ROUTING });
    assert.equal(audio(calls), 1, 'tutti a ritenzione zero: la voce parte');
  });
});

test('voce e dettatura dal cancello: la frase condivisa, con la funzione e dove sceglierne un altro', async () => {
  globalThis.SN_WALLET_MAIN = wallet();
  const model = 'hexgrad/kokoro-82m';
  const hosts = { [model]: [['DeepInfra', 'deepinfra'], ['Together', 'together']] };
  const casi = [
    [{}, 'perché nessun fornitore ammesso lo ospita senza conservare i dati, e coi crediti di Filo è una condizione. Lo servono solo DeepInfra e Together, che non si impegnano a non conservarli.'],
    [{ [model]: [['DeepInfra', 'deepinfra']] }, 'perché lo serve anche Together, che non si impegna a non conservare i dati, e con l\'audio non posso impedire che tocchi a lui. Coi crediti di Filo è una condizione.'],
    [null, 'perché non so quali dei suoi fornitori si impegnano a non conservare i dati, e coi crediti di Filo è una condizione.'],
  ];
  for (const [zdr, motivo] of casi) {
    await withRouter({ hosts, zdr, answer: okFor }, async () => {
      for (const [method, args] of [['synthesizeSpeech', { text: 'ciao' }], ['transcribe', { audioBase64: 'QUJD' }]]) {
        const e = await fallita(cancello().call({ action: 'tts', attempt: tentativo(model), method, args }));
        assert.equal(e.code, 'NO_ALLOWED_HOST', method);
        assert.equal(e.message, `La funzione «Spiega (inline)» non può usare «${model}» ${motivo} Scegline un altro in Opzioni → Modelli per azione.`);
      }
    });
  }
});

test('voce: il ripiego sui crediti parte solo se i crediti ammettono gli host, ritenzione zero compresa', async () => {
  globalThis.SN_WALLET_MAIN = wallet({ fallback: true });
  const model = 'hexgrad/kokoro-82m';
  const hosts = { [model]: [['Together', 'together']] };
  const answer = (url, body, key) => (key === 'sk-own' ? json({ error: { message: 'User not found.' } }, 401) : okFor(url, body));
  await withRouter({ hosts, zdr: {}, answer }, async (calls) => {
    const e = await fallita(OR.synthesizeSpeech({ apiKey: 'sk-own', model, text: 'ciao', providerRouting: ROUTING }));
    assert.equal(e.status, 401, 'risale il rifiuto della chiave propria');
    assert.deepEqual(calls.filter((c) => c.url === OR.SPEECH_ENDPOINT).map((c) => c.key), ['sk-own']);
  });
});

test('l\'avviso mentre si sceglie il modello audio ha una frase per ogni motivo nuovo', () => {
  const I18n = globalThis.SN_I18N;
  for (const k of ['zdr', 'zdr_many', 'zdrmixed', 'zdrmixed_many', 'zdrunknown']) {
    const t = I18n.t(`audio_host_warn_${k}`, 'Voce', 'la lettura ad alta voce', 'Together');
    assert.ok(t && !t.startsWith('audio_host_warn_'), k);
  }
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
