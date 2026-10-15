// #828: un modello che servono solo host esclusi dalla politica fa fallire la richiesta con una frase che dice quale
// modello, quale funzione, perché e dove sceglierne un altro, mai «riprova». Il caso lo riconoscono gli host dichiarati
// dal catalogo, non il testo del 404; la frase la compone solo SN_CHAT_ERRORS.fraseNessunHost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/i18n.js');
require('../../src/shared/chatErrors.js');
require('../../src/main/services/providers/openrouter.js');
require('../../src/main/services/providers/index.js');
require('../../src/main/services/modelGate.js');
const C = globalThis.SN_CONST;
const CE = globalThis.SN_CHAT_ERRORS;
const OR = globalThis.SN_PROVIDER_OPENROUTER;

const ROUTING = { ignore: [...C.DEFAULT_EXCLUDED_PROVIDERS] };
const NO_ALLOWED = 'No allowed providers are available for the selected model.';
const NO_PARAMS = 'No endpoints found that can handle the requested parameters.';
const GEMINI = 'google/gemini-2.5-flash';
const GROK = 'x-ai/grok-4';
const LLAMA = 'meta-llama/llama-3.3-70b-instruct';
const HOSTS = {
  [GEMINI]: [['Google AI Studio', 'google-ai-studio'], ['Google Vertex', 'google-vertex']],
  [GROK]: [['xAI', 'xai']],
  [LLAMA]: [['DeepInfra', 'deepinfra'], ['Together', 'together']],
  'qwen/qwen3-235b': [['Alibaba', 'alibaba'], ['DeepInfra', 'deepinfra']],
};
const OGGI_GENERICA = 'Il servizio AI non è riuscito a rispondere: potrebbe esserci un problema con il modello scelto nelle Impostazioni. Riprova, o prova con un altro modello.';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const rifiuto = (message, status = 404) => json({ error: { code: status, message } }, status);
function risposta(body) {
  if (!body.stream) return json({ provider: 'DeepInfra', choices: [{ message: { content: 'Ecco.' } }], usage: {} });
  const sse = `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'Ecco.' } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
// Il router finto risponde come quello vero: niente host ammessi → 404; il catalogo pubblico dice chi serve cosa.
const routerVero = (testo = NO_ALLOWED) => (body) => {
  const ammessi = (HOSTS[body.model] || []).filter((h) => !C.hostPolicyViolation({ name: h[0], tag: h[1] }, body.model, (body.provider && body.provider.ignore) || []));
  return ammessi.length ? risposta(body) : rifiuto(testo);
};

async function conRouter({ hosts = HOSTS, chat = routerVero() } = {}, run) {
  const vero = globalThis.fetch;
  const corpi = [];
  const cataloghi = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/endpoints')) {
      const model = decodeURIComponent(u.slice(`${OR.MODELS_ENDPOINT}/`.length, -'/endpoints'.length));
      cataloghi.push(model);
      const h = hosts[model];
      if (!h) return json({ error: { code: 404, message: 'Model not found' } }, 404);
      return json({ data: { endpoints: h.map(([provider_name, tag, params]) => ({ provider_name, tag, supported_parameters: params || ['tools', 'max_tokens'] })) } });
    }
    const body = JSON.parse(init.body);
    corpi.push(body);
    return chat(body);
  };
  OR.forgetModelHosts();
  OR.forgetReasoningRefusals();
  try { return await run({ corpi, cataloghi }); } finally { globalThis.fetch = vero; }
}

const ETICHETTE = { explain: 'Spiega (inline)', translate_sel: 'Traduci selezione', archive_embed: 'Indicizzazione dell\'archivio' };
function cancello(settings = { useDefaultModels: false }) {
  return globalThis.SN_MODEL_GATE.create({
    getSettings: async () => settings,
    buildChain: () => [],
    modelFor: () => '',
    costs: { isOverLimit: async () => false, record: async () => 0 },
    funzioneDi: (action) => (action === C.ACTIONS.PROVIDER_TEST ? '' : ETICHETTE[action] || action),
    rimedioDi: (s) => CE.RIMEDI_NESSUN_HOST[s && s.useDefaultModels === false ? 'opzioni' : 'predefiniti'],
  });
}
const tentativo = (model, extra) => ({ provider: 'openrouter', apiKey: 'k', model, providerRouting: ROUTING, ...(extra || {}) });
const MESSAGGI = [{ role: 'user', content: 'ciao' }];
const fallita = (p) => p.then(() => assert.fail('la richiesta doveva fallire'), (e) => e);

function frasePerLUtente(err) {
  // Il viaggio vero: dal main la risposta d'errore dell'IPC, nella pagina la frase.
  return CE.sentence(CE.fromResponse({ error: err.message, code: err.code, status: err.status, provider: err.provider }));
}

for (const via of ['complete', 'stream']) {
  test(`${via}: un 404 su un modello servito solo da host esclusi nomina modello e funzione e manda in Opzioni, senza «riprova»`, async () => {
    for (const testo of [NO_ALLOWED, NO_PARAMS, 'Qualcosa che il router dirà domani']) {
      const err = await conRouter({ chat: routerVero(testo) }, () => fallita(cancello()[via]({
        action: 'explain', attempts: [tentativo(GEMINI)], messages: MESSAGGI, ...(via === 'stream' ? { onDelta: () => {} } : {}),
      })));
      assert.equal(err.code, 'NO_ALLOWED_HOST', testo);
      assert.equal(err.status, 404);
      const frase = frasePerLUtente(err);
      assert.equal(frase, 'La funzione «Spiega (inline)» non può usare «google/gemini-2.5-flash» perché nessun fornitore ammesso lo ospita. Lo servono solo Google AI Studio e Google Vertex, che Filo esclude. Scegline un altro in Opzioni → Modelli per azione.');
      assert.doesNotMatch(frase, /riprov/i);
      assert.equal(CE.rimedio({ code: err.code }), 'opzioni', 'accanto alla frase va il tasto per le Opzioni');
    }
  });
}

test('un host solo: la frase lo nomina al singolare', async () => {
  const err = await conRouter({}, () => fallita(cancello().complete({ action: 'translate_sel', attempts: [tentativo(GROK)], messages: MESSAGGI })));
  assert.equal(err.code, 'NO_ALLOWED_HOST');
  assert.match(CE.sentence(err), /^La funzione «Traduci selezione» non può usare «x-ai\/grok-4» perché nessun fornitore ammesso lo ospita\. Lo serve solo xAI, che Filo esclude\./);
});

test('con i modelli predefiniti la frase dice di toglierli per sceglierne un altro', async () => {
  const err = await conRouter({}, () => fallita(cancello({ useDefaultModels: true }).complete({ action: 'explain', attempts: [tentativo(GEMINI)], messages: MESSAGGI })));
  assert.match(CE.sentence(err), /Per sceglierne un altro togli «Usa modelli predefiniti» in Opzioni e impostalo in Modelli per azione\.$/);
});

test('la catena passa al modello dopo come prima: la frase arriva solo quando falliscono tutti', async () => {
  const r = await conRouter({}, ({ corpi }) => cancello().complete({ action: 'explain', attempts: [tentativo(GEMINI), tentativo(LLAMA)], messages: MESSAGGI })
    .then((x) => ({ ...x, modelli: corpi.map((b) => b.model) })));
  assert.equal(r.text, 'Ecco.');
  assert.equal(r.model, LLAMA);
  assert.deepEqual(r.modelli, [GEMINI, LLAMA]);

  const err = await conRouter({}, () => fallita(cancello().stream({ action: 'explain', attempts: [tentativo(GEMINI), tentativo(GROK)], messages: MESSAGGI, onDelta: () => {} })));
  assert.equal(err.code, 'NO_ALLOWED_HOST');
  assert.match(CE.sentence(err), /non può usare «x-ai\/grok-4»/);
});

test('un 404 di altra natura tiene la frase di oggi', async () => {
  // Modello che il catalogo non conosce: non è più servito da nessuno.
  const inesistente = await conRouter({ chat: () => rifiuto('No endpoints found for acme/sparito.') }, () => fallita(cancello().complete({ action: 'explain', attempts: [tentativo('acme/sparito')], messages: MESSAGGI })));
  assert.equal(inesistente.code, 'MODEL_UNAVAILABLE');
  assert.match(CE.sentence(inesistente), /non è più disponibile/);

  // Host ammessi che non reggono gli strumenti: il ramo «tool».
  const tools = [{ type: 'function', function: { name: 'CERCA_WEB', parameters: { type: 'object', properties: {} } } }];
  const strumenti = await conRouter({ chat: () => rifiuto(NO_PARAMS) }, () => fallita(cancello().complete({ action: 'explain', attempts: [tentativo(LLAMA)], messages: MESSAGGI, tools })));
  assert.equal(strumenti.code, 'NO_TOOL_HOST');
  assert.match(CE.sentence(strumenti), /sa usare gli strumenti/);

  // Un 404 qualunque su un modello con host ammessi resta la frase generica.
  const qualunque = await conRouter({ chat: () => rifiuto('Not Found') }, () => fallita(cancello().complete({ action: 'explain', attempts: [tentativo(LLAMA)], messages: MESSAGGI })));
  assert.equal(qualunque.code, undefined);
  assert.equal(CE.sentence(qualunque), OGGI_GENERICA);

  // Host misti: uno ammesso c'è, il 404 ha un'altra causa (per esempio i filtri dell'account).
  const misti = await conRouter({ chat: () => rifiuto(NO_ALLOWED) }, () => fallita(cancello().complete({ action: 'explain', attempts: [tentativo('qwen/qwen3-235b')], messages: MESSAGGI })));
  assert.equal(misti.code, 'NO_PROVIDER_ALLOWED');
});

test('il catalogo che non risponde non inventa il caso: resta la frase di oggi', async () => {
  const err = await conRouter({ hosts: {}, chat: () => rifiuto(NO_ALLOWED) }, () => fallita(cancello().complete({ action: 'explain', attempts: [tentativo(GEMINI)], messages: MESSAGGI })));
  assert.equal(err.code, 'NO_PROVIDER_ALLOWED');
  assert.match(CE.sentence(err), /fra quelli ammessi/);
});

test('la frase compare solo se la lista di esclusione è stata mandata davvero', async () => {
  const err = await conRouter({ chat: () => rifiuto(NO_ALLOWED) }, async ({ cataloghi }) => {
    const e = await fallita(cancello().complete({ action: 'explain', attempts: [tentativo(GEMINI, { providerRouting: null })], messages: MESSAGGI }));
    assert.deepEqual(cataloghi, [], 'senza lista non c\'è niente da confrontare: il catalogo non si chiede');
    return e;
  });
  assert.notEqual(err.code, 'NO_ALLOWED_HOST');
});

test('la prova di una riga delle Opzioni mostra la stessa spiegazione', async () => {
  const gate = cancello();
  const chat = await conRouter({}, () => fallita(gate.complete({ action: 'explain', attempts: [tentativo(GEMINI)], messages: MESSAGGI })));
  const prova = await conRouter({}, () => fallita(gate.call({
    action: C.ACTIONS.PROVIDER_TEST, attempt: tentativo(GEMINI), method: 'streamComplete', args: { messages: MESSAGGI, onDelta: () => {} },
  })));
  assert.equal(prova.code, 'NO_ALLOWED_HOST');
  assert.equal(prova.message, 'Filo non può usare «google/gemini-2.5-flash» perché nessun fornitore ammesso lo ospita. Lo servono solo Google AI Studio e Google Vertex, che Filo esclude. Scegline un altro in Opzioni → Modelli per azione.');
  const spiegazione = (s) => s.slice(s.indexOf('«google/'));
  assert.equal(spiegazione(prova.message), spiegazione(chat.message));
});

test('l\'indicizzazione passa dallo stesso router e dice la stessa cosa', async () => {
  const err = await conRouter({ chat: () => rifiuto(NO_ALLOWED) }, () => fallita(cancello().call({
    action: 'archive_embed', attempt: tentativo(GEMINI), method: 'embed', args: { texts: ['ciao'] },
  })));
  assert.equal(err.code, 'NO_ALLOWED_HOST');
  assert.match(err.message, /^La funzione «Indicizzazione dell'archivio» non può usare «google\/gemini-2\.5-flash» perché nessun fornitore ammesso/);
});

test('voce e dettatura tengono la loro frase, scritta prima di chiamare', async () => {
  const err = await conRouter({}, () => fallita(cancello().call({
    action: 'tts', attempt: tentativo('google/gemini-2.5-flash-preview-tts'), method: 'synthesizeSpeech', args: { text: 'ciao' },
  })));
  assert.equal(err.code, 'NO_ALLOWED_HOST');
  assert.doesNotMatch(err.message, /^La funzione/);
});

test('fraseNessunHost: un altro motivo e un altro rimedio cambiano solo quelle parti', () => {
  const base = { modello: GEMINI, funzione: 'Spiega (inline)' };
  const oggi = CE.fraseNessunHost(base);
  assert.equal(oggi, 'La funzione «Spiega (inline)» non può usare «google/gemini-2.5-flash» perché nessun fornitore ammesso lo ospita. Scegline un altro in Opzioni → Modelli per azione.');
  const altra = CE.fraseNessunHost({ ...base, motivo: 'MOTIVO FINTO', rimedio: 'Rimedio finto.' });
  assert.equal(altra, oggi.replace(CE.NESSUN_HOST_MOTIVO, 'MOTIVO FINTO').replace(CE.RIMEDI_NESSUN_HOST.opzioni, 'Rimedio finto.'));
  assert.equal(CE.fraseNessunHost({ ...base, motivo: 'MOTIVO FINTO' }), oggi.replace(CE.NESSUN_HOST_MOTIVO, 'MOTIVO FINTO'));
  assert.equal(CE.fraseNessunHost({ ...base, rimedio: 'Rimedio finto' }), oggi.replace(CE.RIMEDI_NESSUN_HOST.opzioni, 'Rimedio finto.'));
});

test('fraseNessunHost regge dati strani: vuoti, lunghissimi, tanti host', () => {
  assert.equal(CE.fraseNessunHost(), 'Filo non può usare il modello scelto perché nessun fornitore ammesso lo ospita. Scegline un altro in Opzioni → Modelli per azione.');
  assert.equal(CE.fraseNessunHost({ modello: '   ', funzione: '  ', motivo: '  ', rimedio: ' ' }), CE.fraseNessunHost());
  const lungo = CE.fraseNessunHost({ modello: `a/${'x'.repeat(5000)}`, funzione: 'y'.repeat(5000) });
  assert.ok(lungo.length < 600, 'nomi lunghissimi si accorciano, con i puntini');
  assert.match(lungo, /…»/);
  const tanti = CE.motivoHostEsclusi(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'a', '', null]);
  assert.equal(tanti, 'nessun fornitore ammesso lo ospita. Lo servono solo A, B, C, D, E e altri 2, che Filo esclude');
  assert.equal(CE.motivoHostEsclusi([]), CE.NESSUN_HOST_MOTIVO);
  assert.equal(CE.motivoHostEsclusi(['Solo']), 'nessun fornitore ammesso lo ospita. Lo serve solo Solo, che Filo esclude');
});
