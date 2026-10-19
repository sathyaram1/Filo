// #829: Claude lo serve solo Anthropic (#904). Se Anthropic non risponde la catena passa al modello dopo; a catena finita
// la richiesta fallisce con la frase del #828 e il motivo «lo serve solo Anthropic, e adesso non risponde», senza altri host.

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
require('../../src/shared/contatoriGiornalieri.js');
const C = globalThis.SN_CONST;
const CE = globalThis.SN_CHAT_ERRORS;
const OR = globalThis.SN_PROVIDER_OPENROUTER;

const CLAUDE = 'anthropic/claude-haiku-4.5';
const LLAMA = 'meta-llama/llama-3.3-70b-instruct';
const SOLO_ANTHROPIC = ['anthropic', 'claude-on-aws'];
const ROUTING = { ignore: [...C.DEFAULT_EXCLUDED_PROVIDERS] };
const MOTIVO = 'questo modello lo serve solo Anthropic, e adesso non risponde';
const SPIEGAZIONE = `non può usare «${CLAUDE}» perché ${MOTIVO}. Scegline un altro in Opzioni → Modelli per azione.`;
const HOSTS = {
  [CLAUDE]: [['Anthropic', 'anthropic'], ['Amazon Bedrock', 'amazon-bedrock'], ['Google Vertex', 'google-vertex']],
  [LLAMA]: [['DeepInfra', 'deepinfra'], ['Together', 'together']],
};

// Retry-After 0: il ritentativo sul 5xx resta (è del router), senza il secondo di attesa.
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'retry-after': '0' } });
const rifiuto = (status, message) => json({ error: { code: status, message } }, status);
function risposta(body, host = 'DeepInfra') {
  if (!body.stream) return json({ provider: host, choices: [{ message: { content: 'Ecco.' } }], usage: {} });
  const sse = `data: ${JSON.stringify({ provider: host, choices: [{ delta: { content: 'Ecco.' } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
// Anthropic è giù: Claude risponde con `giu`, gli altri modelli rispondono.
const anthropicGiu = (giu) => (body) => (body.model === CLAUDE ? giu() : risposta(body));

async function conRouter(chat, run) {
  const vero = globalThis.fetch;
  const corpi = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/endpoints')) {
      const model = decodeURIComponent(u.slice(`${OR.MODELS_ENDPOINT}/`.length, -'/endpoints'.length));
      const h = HOSTS[model] || [];
      return json({ data: { endpoints: h.map(([provider_name, tag]) => ({ provider_name, tag, supported_parameters: ['tools', 'max_tokens'] })) } });
    }
    const body = JSON.parse(init.body);
    corpi.push(body);
    return chat(body);
  };
  OR.forgetModelHosts();
  OR.forgetReasoningRefusals();
  try { return await run({ corpi }); } finally { globalThis.fetch = vero; }
}

function cancello(settings = { useDefaultModels: false }) {
  return globalThis.SN_MODEL_GATE.create({
    getSettings: async () => settings,
    buildChain: () => [],
    modelFor: () => '',
    costs: { isOverLimit: async () => false, record: async () => 0 },
    funzioneDi: (action) => (action === C.ACTIONS.PROVIDER_TEST ? '' : 'Spiega (inline)'),
    rimedioDi: (s, action, err) => CE.rimedioNessunHost(s && s.useDefaultModels === false ? 'opzioni' : 'predefiniti', err, s),
  });
}
const tentativo = (model, extra) => ({ provider: 'openrouter', apiKey: 'k', model, providerRouting: ROUTING, ...(extra || {}) });
const MESSAGGI = [{ role: 'user', content: 'ciao' }];
const fallita = (p) => p.then(() => assert.fail('la richiesta doveva fallire'), (e) => e);
const frasePerLUtente = (err) => CE.sentence(CE.fromResponse({ error: err.message, code: err.code, status: err.status, provider: err.provider }));

const GUASTI = {
  'servizio giù (502)': () => rifiuto(502, 'Provider returned error'),
  'nessun host disponibile (503)': () => rifiuto(503, 'No available model provider that meets your routing requirements'),
  'sovraccarico (529)': () => rifiuto(529, 'Overloaded'),
  'nessun host fra gli ammessi (404)': () => rifiuto(404, 'No allowed providers are available for the selected model.'),
  'restrizioni sui fornitori (404)': () => rifiuto(404, 'No endpoints found matching your data policy and provider restrictions.'),
};

for (const via of ['complete', 'stream']) {
  for (const [nome, giu] of Object.entries(GUASTI)) {
    test(`${via}, ${nome}: Claude senza altri modelli fallisce col codice e la frase del #828, e il motivo di Anthropic`, async () => {
      const { err, corpi } = await conRouter(anthropicGiu(giu), async ({ corpi }) => ({
        err: await fallita(cancello()[via]({ action: 'explain', attempts: [tentativo(CLAUDE)], messages: MESSAGGI, ...(via === 'stream' ? { onDelta: () => {} } : {}) })),
        corpi,
      }));
      assert.equal(err.code, 'NO_ALLOWED_HOST');
      const frase = frasePerLUtente(err);
      assert.equal(frase, `La funzione «Spiega (inline)» ${SPIEGAZIONE}`);
      assert.doesNotMatch(frase, /riprov/i);
      assert.equal(CE.rimedio({ code: err.code }), 'opzioni');
      assert.ok(corpi.length >= 1);
      for (const b of corpi) {
        assert.equal(b.model, CLAUDE);
        assert.deepEqual(b.provider.only, SOLO_ANTHROPIC, 'ogni tentativo resta legato ad Anthropic');
      }
    });
  }
}

test('con un altro modello nella catena risponde quello, senza frase', async () => {
  for (const via of ['complete', 'stream']) {
    const r = await conRouter(anthropicGiu(GUASTI['servizio giù (502)']), ({ corpi }) => cancello()[via]({
      action: 'explain', attempts: [tentativo(CLAUDE), tentativo(LLAMA)], messages: MESSAGGI, ...(via === 'stream' ? { onDelta: () => {} } : {}),
    }).then((x) => ({ ...x, modelli: corpi.map((b) => b.model), primo: corpi[0] })));
    assert.equal(r.text, 'Ecco.', via);
    assert.equal(r.model, LLAMA);
    assert.equal(r.modelli[0], CLAUDE);
    assert.equal(r.modelli[r.modelli.length - 1], LLAMA);
    assert.deepEqual(r.primo.provider.only, SOLO_ANTHROPIC);
  }
});

test('nei contatori giornalieri Anthropic giù è un guasto del servizio, non un «nessun host»', async () => {
  const K = globalThis.SN_CONTATORI;
  const tipo = async (model, giu) => K.tipoErrore(await conRouter((body) => (body.model === model ? giu() : risposta(body)),
    () => fallita(cancello().complete({ action: 'explain', attempts: [tentativo(model)], messages: MESSAGGI }))));
  assert.equal(await tipo(CLAUDE, () => rifiuto(503, 'Provider returned error')), 'fornitore');
  assert.equal(await tipo(CLAUDE, GUASTI['nessun host fra gli ammessi (404)']), 'fornitore');
  assert.equal(await tipo(CLAUDE, () => rifiuto(504, 'Gateway Timeout')), 'tempo');
  assert.equal(await tipo(LLAMA, () => rifiuto(503, 'Provider returned error')), 'fornitore');
  assert.equal(K.tipoErrore(Object.assign(new Error('x'), { code: 'NO_ALLOWED_HOST', reason: 'excluded', status: 404 })), 'nessun_host');
});

test('Anthropic che si ferma a metà flusso prima di scrivere è lo stesso guasto', async () => {
  const fermo = () => new Response(`data: ${JSON.stringify({ provider: 'Anthropic', choices: [{ delta: {}, finish_reason: 'error' }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const err = await conRouter(anthropicGiu(fermo), () => fallita(cancello().stream({ action: 'explain', attempts: [tentativo(CLAUDE)], messages: MESSAGGI, onDelta: () => {} })));
  assert.equal(err.code, 'NO_ALLOWED_HOST');
  assert.equal(err.message, `La funzione «Spiega (inline)» ${SPIEGAZIONE}`);
});

test('gli altri guasti tengono la loro frase: modelli a pesi aperti, privacy dell\'account, strumenti, errori del router', async () => {
  const aperto = await conRouter(() => rifiuto(502, 'Provider returned error'), () => fallita(cancello().complete({ action: 'explain', attempts: [tentativo(LLAMA)], messages: MESSAGGI })));
  assert.notEqual(aperto.code, 'NO_ALLOWED_HOST');
  assert.doesNotMatch(frasePerLUtente(aperto), /Anthropic/);

  const privacy = await conRouter(() => rifiuto(404, 'No endpoints found matching your data policy. Configure: https://openrouter.ai/settings/privacy'), () => fallita(cancello().complete({ action: 'explain', attempts: [tentativo(CLAUDE)], messages: MESSAGGI })));
  assert.equal(privacy.code, 'DATA_POLICY');

  const tools = [{ type: 'function', function: { name: 'CERCA_WEB', parameters: { type: 'object', properties: {} } } }];
  const strumenti = await conRouter(() => rifiuto(404, 'No endpoints found that can handle the requested parameters.'), () => fallita(cancello().complete({ action: 'explain', attempts: [tentativo(CLAUDE)], messages: MESSAGGI, tools })));
  assert.equal(strumenti.code, 'NO_TOOL_HOST');

  const router = await conRouter(() => rifiuto(500, 'Internal Server Error'), () => fallita(cancello().complete({ action: 'explain', attempts: [tentativo(CLAUDE)], messages: MESSAGGI })));
  assert.notEqual(router.code, 'NO_ALLOWED_HOST');

  const sparito = await conRouter(() => rifiuto(404, `No endpoints found for ${CLAUDE}.`), () => fallita(cancello().complete({ action: 'explain', attempts: [tentativo(CLAUDE)], messages: MESSAGGI })));
  assert.equal(sparito.code, 'MODEL_UNAVAILABLE');
});

test('con la chiave propria la frase non propone i fornitori esclusi: il vincolo di Anthropic resta', () => {
  const err = { code: 'NO_ALLOWED_HOST', reason: 'produttore', keySource: 'own' };
  assert.equal(CE.rimedioNessunHost('opzioni', err, {}), CE.RIMEDI_NESSUN_HOST.opzioni);
  assert.match(CE.rimedioNessunHost('opzioni', { ...err, reason: 'excluded' }, {}), /fornitori esclusi/);
});

test('il «Prova» di una riga con Claude manda lo stesso vincolo, e se Anthropic non risponde dice lo stesso', async () => {
  const gate = cancello();
  const prova = (onDelta = () => {}) => gate.call({
    action: C.ACTIONS.PROVIDER_TEST, attempt: tentativo(CLAUDE), method: 'streamComplete', args: { messages: MESSAGGI, onDelta },
  });
  const ok = await conRouter((body) => risposta(body, 'Anthropic'), async ({ corpi }) => ({ r: await prova(), corpi }));
  assert.equal(ok.r.text, 'Ecco.');
  assert.equal(ok.r.violation, false);
  assert.equal(ok.corpi.length, 1);
  assert.deepEqual(ok.corpi[0].provider.only, SOLO_ANTHROPIC);
  assert.ok(ok.corpi[0].provider.ignore.length > 0, 'la lista di esclusione di oggi resta');

  const err = await conRouter(anthropicGiu(GUASTI['servizio giù (502)']), () => fallita(prova()));
  assert.equal(err.code, 'NO_ALLOWED_HOST');
  assert.equal(err.message, `Filo ${SPIEGAZIONE}`);
});

test('motivoProduttoreGiu regge un nome vuoto o lunghissimo', () => {
  assert.equal(CE.motivoProduttoreGiu('Anthropic'), MOTIVO);
  assert.equal(CE.motivoProduttoreGiu(''), 'questo modello lo serve solo il suo produttore, e adesso non risponde');
  assert.ok(CE.motivoProduttoreGiu('x'.repeat(5000)).length < 200);
});
