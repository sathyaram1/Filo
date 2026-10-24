// Coi crediti di Filo girano solo le tre categorie della politica sui modelli (#830): Anthropic, pesi aperti, modelli
// stretti ammessi per nome. Un modello fuori categoria con la chiave dei crediti non parte e lo dice con la frase di
// #828; con la chiave propria parte; la chiave propria rifiutata non ripiega sui crediti per quel modello.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/i18n.js');
require('../../src/shared/wallet.js');
require('../../src/shared/chatErrors.js');
require('../../src/shared/contatoriGiornalieri.js');
require('../../src/main/services/providers/openrouter.js');
require('../../src/main/services/providers/index.js');
require('../../src/main/services/modelGate.js');
const C = globalThis.SN_CONST;
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const CE = globalThis.SN_CHAT_ERRORS;

const KEYS = { 'sk-own': 'own', 'sk-personal': 'personal', 'sk-factory': 'factory' };
const CHIUSO = 'openai/gpt-5';
const APERTO = 'deepseek/deepseek-v4-pro';
const CLAUDE = 'anthropic/claude-haiku-4.5';
const JEV = 'typesafe/jev-1.13';
let refusals = [];

function wallet() {
  return {
    keySourceOf: async (k) => KEYS[k] || '',
    alternativeKeyFor: async (k) => (k === 'sk-own' ? { key: 'sk-personal', source: 'personal' } : null),
    noteOwnKeyRefusal: async (r) => { refusals.push(r); },
    noteOwnKeySuccess: async () => {},
  };
}

const res = (obj, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => null },
  clone() { return this; },
  async json() { return obj; },
  async text() { return JSON.stringify(obj); },
  async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer; },
});

// Il router finto: ogni host serve, `refuse` dice quali chiavi rifiuta con 401.
let calls = [];
let refuse = new Set();
function router() {
  return async (url, init) => {
    const u = String(url);
    const key = String((init && init.headers && init.headers.Authorization) || '').replace(/^Bearer /, '');
    calls.push({ url: u, key });
    if (u.endsWith('/endpoints')) return res({ data: { endpoints: [{ provider_name: 'DeepInfra', tag: 'deepinfra' }] } });
    if (u === OR.ZDR_ENDPOINT) return res({ data: [JEV, APERTO, CLAUDE].map((id) => ({ name: `DeepInfra | ${id}`, provider_name: 'DeepInfra', tag: 'deepinfra' })) });
    if (refuse.has(key)) return res({ error: { message: 'User not found.' } }, 401);
    if (u === OR.EMBEDDINGS_ENDPOINT) return res({ data: [{ index: 0, embedding: [0.1] }] });
    if (u === OR.TRANSCRIPTIONS_ENDPOINT) return res({ text: 'ciao' });
    if (u === OR.DECISIONS_ENDPOINT) return res({ answers: { a: 0.9 } });
    return res({ choices: [{ message: { content: 'ok' } }], provider: 'DeepInfra' });
  };
}
const chiamateVere = () => calls.filter((c) => !c.url.endsWith('/endpoints') && c.url !== OR.ZDR_ENDPOINT);

const realFetch = global.fetch;
beforeEach(() => {
  calls = []; refusals = []; refuse = new Set();
  OR.forgetModelHosts();
  globalThis.SN_WALLET_MAIN = wallet();
  global.fetch = router();
});
afterEach(() => { delete globalThis.SN_WALLET_MAIN; global.fetch = realFetch; });

test('le tre categorie: Anthropic, pesi aperti (gpt-oss compreso), modelli stretti per nome; il resto no', () => {
  for (const m of [APERTO, CLAUDE, '~anthropic/claude-sonnet-latest', JEV, 'openai/gpt-oss-120b', 'hexgrad/kokoro-82m', 'openai/whisper-large-v3-turbo', 'moonshotai/kimi-k3']) {
    assert.equal(C.creditsAllowModel(m), true, m);
  }
  for (const m of [CHIUSO, 'amazon/nova-pro-v1', 'perplexity/sonar', 'deepgram/aura-2', 'google/gemini-3.1-flash-lite-preview', 'x-ai/grok-4']) {
    assert.equal(C.creditsAllowModel(m), false, m);
  }
  assert.equal(C.creditsAllowModel('acme/modello-x', 'open'), true, 'la voce del registro dichiarata aperta vince sul nome');
  assert.equal(C.creditsAllowModel(APERTO, 'proprietary'), false, '…anche nell’altro verso');
});

test('le versioni a pesi chiusi di famiglie aperte (Qwen Max, Mistral Medium, Yi Large) non passano per aperte, coi crediti né con l’interruttore', () => {
  for (const m of ['qwen/qwen3-max', 'qwen/qwen-max', 'qwen/qwen-plus-2025-07-28', 'qwen/qwen3-coder-plus', 'qwen/qwen-turbo', 'qwen/qwen-flash',
    'mistralai/mistral-medium-3.1', 'mistralai/mistral-saba', '01-ai/yi-large', 'qwen/qwen3-max:free']) {
    assert.equal(C.creditsAllowModel(m), false, m);
    assert.equal(C.isOpenWeightsModelId(m), false, m);
  }
  for (const m of ['qwen/qwen3-235b-a22b-2507', 'qwen/qwen3-coder', 'qwen/qwen3-embedding-8b', 'qwen/qwen-2.5-72b-instruct', 'qwen/qwen3-next-80b-a3b-instruct',
    'mistralai/mistral-small-3.2-24b-instruct', 'mistralai/mistral-large-2411', 'mistralai/mistral-7b-instruct', 'z-ai/glm-5.3-flash']) {
    assert.equal(C.creditsAllowModel(m), true, m);
  }
  assert.equal(C.creditsAllowModel('qwen/qwen3-max', 'open'), true, 'la voce dichiarata aperta dal registro vince ancora');
});

test('i modelli a pesi aperti di famiglie meno note passano coi crediti; le loro versioni solo via API no', () => {
  for (const m of ['microsoft/wizardlm-2-8x22b', 'gryphe/mythomax-l2-13b', 'sao10k/l3.3-euryale-70b', 'anthracite-org/magnum-v4-72b',
    'thedrummer/cydonia-24b-v4.1', 'thedrummer/rocinante-12b', 'microsoft/mai-ds-r1', 'tngtech/tng-r1t-chimera',
    'agentica-org/deepcoder-14b-preview', 'alpindale/goliath-120b','qwen/qwq-32b', 'mistralai/devstral-small', 'mistralai/devstral-2512', 'mistralai/magistral-small-2506', 'mistralai/pixtral-12b',
    'mistralai/pixtral-large-2411', 'mistralai/ministral-8b', 'mistralai/voxtral-small-24b-2507', 'nousresearch/hermes-4-405b',
    'nousresearch/deephermes-3-mistral-24b-preview', 'baidu/ernie-4.5-300b-a47b', 'baidu/ernie-4.5-21b-a3b-thinking', 'tencent/hunyuan-a13b-instruct',
    'bytedance-seed/seed-oss-36b-instruct', 'meituan/longcat-flash-chat', 'ai21/jamba-large-1.7', 'liquid/lfm2-8b-a1b', 'liquid/lfm-2.2-6b',
    'prime-intellect/intellect-3', 'inclusionai/ling-1t', 'inclusionai/ring-1t', 'cohere/command-a', 'cohere/aya-expanse-32b', 'arcee-ai/trinity-mini',
    'cognitivecomputations/dolphin-mistral-24b-venice-edition', 'servicenow/apriel-1.5-15b-thinker', 'deepcogito/cogito-v2-preview-llama-405b',
    'xiaomi/mimo-v2-flash', 'alibaba/tongyi-deepresearch-30b-a3b', 'bytedance/ui-tars-1.5-7b']) {
    assert.equal(C.creditsAllowModel(m), true, m);
    assert.equal(C.isOpenWeightsModelId(m), true, m);
  }
  for (const m of ['mistralai/devstral-medium', 'mistralai/magistral-medium-2506', 'baidu/ernie-x1-turbo-32k', 'baidu/ernie-4.5-turbo-128k',
    'tencent/hunyuan-t1', 'liquid/lfm-40b', 'mistralai/codestral-2508', 'cohere/command']) {
    assert.equal(C.creditsAllowModel(m), false, m);
  }
});

test('coi crediti un modello fuori categoria non parte: codice e frase condivisi, che rimandano a Crediti', async () => {
  for (const key of ['sk-personal', 'sk-factory']) {
    calls = [];
    await assert.rejects(OR.complete({ apiKey: key, model: CHIUSO, messages: [] }), (e) => {
      assert.equal(e.code, 'NO_ALLOWED_HOST');
      assert.ok(CE.CODICI_GIA_SCRITTI.includes(e.code), 'la frase passa invariata');
      assert.equal(e.message, CE.fraseNessunHost({ modello: CHIUSO, motivo: CE.MOTIVO_CREDITI, rimedio: CE.rimedioCrediti('opzioni') }));
      assert.match(e.message, /coi crediti di Filo questo modello non si usa/);
      assert.match(e.message, /tua chiave OpenRouter nella pagina Crediti/);
      assert.match(e.message, /Opzioni → Modelli per azione/);
      assert.equal(CE.friendly(e), e.message);
      assert.equal(CE.rimedioPagina({ code: e.code, reason: e.reason }).url, 'filo://credits/credits.html', 'il tasto porta a Crediti');
      assert.equal(CE.rimedioPagina(CE.fromResponse({ error: e.message, code: e.code, reason: 'crediti' })).dove, 'crediti', 'anche dopo l’IPC');
      return true;
    }, key);
    assert.equal(calls.length, 0, `${key}: la richiesta non deve partire`);
  }
});

test('coi crediti passano un modello a pesi aperti, uno di Anthropic e Jev; con la chiave propria parte anche il chiuso', async () => {
  for (const model of [APERTO, CLAUDE]) {
    const r = await OR.complete({ apiKey: 'sk-personal', model, messages: [] });
    assert.equal(r.text, 'ok', model);
  }
  const d = await OR.decisions({ apiKey: 'sk-personal', model: JEV, state: 's', questions: { a: 'q' } });
  assert.deepEqual(d.answers, { a: 0.9 });
  calls = [];
  const r = await OR.complete({ apiKey: 'sk-own', model: CHIUSO, messages: [] });
  assert.equal(r.text, 'ok');
  assert.deepEqual(chiamateVere().map((c) => c.key), ['sk-own']);
});

test('vale per ogni chiamata che passa dalla chiave: chat in streaming, voce, dettatura, indicizzazione', async () => {
  const prove = {
    stream: () => OR.streamComplete({ apiKey: 'sk-personal', model: CHIUSO, messages: [] }),
    voce: () => OR.synthesizeSpeech({ apiKey: 'sk-personal', model: 'deepgram/aura-2', text: 'ciao' }),
    dettatura: () => OR.transcribe({ apiKey: 'sk-personal', model: 'openai/gpt-4o-transcribe', audioBase64: 'QUJD' }),
    indicizzazione: () => OR.embed({ apiKey: 'sk-factory', model: 'openai/text-embedding-3-small', texts: ['a'] }),
  };
  for (const [nome, prova] of Object.entries(prove)) {
    calls = [];
    await assert.rejects(prova(), (e) => e.code === 'NO_ALLOWED_HOST' && e.reason === 'crediti', nome);
    assert.equal(calls.length, 0, `${nome}: nessuna chiamata, nemmeno per chiedere gli host`);
  }
});

test('ripiego: chiave propria rifiutata con un modello fuori categoria → nessuna seconda chiamata coi crediti, e l’errore dice perché', async () => {
  refuse = new Set(['sk-own']);
  await assert.rejects(OR.complete({ apiKey: 'sk-own', model: CHIUSO, messages: [] }), (e) => {
    assert.equal(e.code, 'NO_ALLOWED_HOST');
    assert.equal(e.reason, 'crediti');
    assert.match(e.message, /OpenRouter ha rifiutato la tua chiave, e coi crediti di Filo questo modello non si usa/);
    assert.match(e.message, /Controlla la tua chiave nella pagina Crediti/);
    return true;
  });
  assert.deepEqual(chiamateVere().map((c) => c.key), ['sk-own'], 'i crediti non pagano');
  assert.equal(refusals.length, 1, 'il rifiuto della chiave propria resta registrato per la pagina Crediti');
  assert.equal(refusals[0].served, false);

  // Con un modello aperto il ripiego avviene come prima.
  calls = []; refusals = [];
  const r = await OR.complete({ apiKey: 'sk-own', model: APERTO, messages: [] });
  assert.equal(r.text, 'ok');
  assert.deepEqual(chiamateVere().map((c) => c.key), ['sk-own', 'sk-personal']);
  assert.equal(r.keyFallback.to, 'personal');
});

test('ripiego anche per voce e dettatura: la chiave propria rifiutata non passa ai crediti con un modello chiuso', async () => {
  refuse = new Set(['sk-own']);
  await assert.rejects(OR.transcribe({ apiKey: 'sk-own', model: 'openai/gpt-4o-transcribe', audioBase64: 'QUJD' }),
    (e) => e.reason === 'crediti' && e.chiaveRifiutata === 401);
  assert.deepEqual(chiamateVere().map((c) => c.key), ['sk-own']);
});

function gate({ funzione = '', dove = 'opzioni' } = {}) {
  return globalThis.SN_MODEL_GATE.create({
    getSettings: async () => ({}),
    buildChain: () => [],
    modelFor: () => '',
    costs: { isOverLimit: async () => false, record: async () => 0 },
    funzioneDi: () => funzione,
    rimedioDi: (s, action, err) => CE.rimedioNessunHost(dove, err, s),
  });
}

test('chi conosce la funzione la nomina, e il rimedio dice dove si sceglie il modello; la prova delle Opzioni dice «Filo»', async () => {
  const attempt = { provider: 'openrouter', apiKey: 'sk-personal', model: CHIUSO };
  await assert.rejects(gate({ funzione: 'Spiega' }).call({ action: 'explain', attempt, method: 'streamComplete', args: { messages: [] } }), (e) => {
    assert.equal(e.message, 'La funzione «Spiega» non può usare «openai/gpt-5» perché coi crediti di Filo questo modello non si usa. '
      + 'Per usarlo metti una tua chiave OpenRouter nella pagina Crediti, o scegline un altro in Opzioni → Modelli per azione.');
    return true;
  });
  // La voce ha frasi sue per gli host; questa no: è la stessa ovunque.
  await assert.rejects(gate({ funzione: 'Leggi ad alta voce', dove: 'predefiniti' }).call({
    action: 'tts', attempt: { ...attempt, model: 'deepgram/aura-2' }, method: 'synthesizeSpeech', args: { text: 'ciao' },
  }), /La funzione «Leggi ad alta voce» non può usare «deepgram\/aura-2» perché coi crediti di Filo questo modello non si usa\. Per usarlo metti una tua chiave OpenRouter nella pagina Crediti; per sceglierne un altro togli «Usa modelli predefiniti»/);
  // Il «Prova» di una riga: nessuna funzione, la stessa frase.
  await assert.rejects(gate().call({ action: C.ACTIONS.PROVIDER_TEST, attempt, method: 'streamComplete', args: { messages: [] } }),
    (e) => /^Filo non può usare «openai\/gpt-5» perché coi crediti di Filo questo modello non si usa\. Per usarlo metti una tua chiave OpenRouter nella pagina Crediti/.test(e.message));
  assert.equal(calls.length, 0);
});

test('la voce del registro dichiarata aperta passa anche coi crediti: i pesi viaggiano con le istruzioni di routing', async () => {
  const routing = C.providerRoutingFor({}, '', 'open');
  assert.equal(routing.weights, 'open');
  const r = await OR.complete({ apiKey: 'sk-personal', model: 'acme/modello-x', messages: [], providerRouting: routing });
  assert.equal(r.text, 'ok');
  const sent = C.buildModelAttempts(['x'], { x: { provider: 'openrouter', model: 'acme/modello-x', weights: 'open' } }, C.PROVIDER_ORDER, { openrouter: 'k' });
  assert.equal(sent[0].weights, 'open');
  assert.equal(C.providerRoutingFor({}, '', ''), null, 'senza niente da dire resta null');
});

test('nei contatori un modello che i crediti non pagano non è un guasto; la chiave propria rifiutata sì', () => {
  const tipo = globalThis.SN_CONTATORI.tipoErrore;
  assert.equal(tipo(Object.assign(new Error('x'), { code: 'NO_ALLOWED_HOST', reason: 'crediti' })), null);
  assert.equal(tipo(Object.assign(new Error('x'), { code: 'NO_ALLOWED_HOST', reason: 'crediti', chiaveRifiutata: 401 })), 'chiave');
});

test('un modello che il catalogo del router dà a pesi pubblicati passa coi crediti anche se il suo nome non è fra le famiglie', async () => {
  const WIZARD = 'acme/apertissimo-7b';
  const catalogo = [
    { id: WIZARD, hugging_face_id: 'acme/Apertissimo-7B' },
    { id: 'acme/altro-aperto-70b', hugging_face_id: 'acme/Altro-Aperto-70B' },
    { id: 'acme/chiuso-pro', hugging_face_id: '' },
    { id: 'acme/chiuso-plus', hugging_face_id: null },
  ];
  try {
    C.registraCatalogoPesi([]);
    C.registraCaricatoreCatalogo(null);
    assert.equal(C.creditsAllowModel(WIZARD), false, 'senza catalogo decidono i nomi');
    await assert.rejects(OR.complete({ apiKey: 'sk-personal', model: WIZARD, messages: [] }), (e) => e.reason === 'crediti');

    // Il catalogo si legge al primo rifiuto, e la richiesta parte coi crediti.
    let letture = 0;
    C.registraCaricatoreCatalogo(async () => { letture++; C.registraCatalogoPesi(catalogo); });
    calls = [];
    const r = await OR.complete({ apiKey: 'sk-personal', model: WIZARD, messages: [] });
    assert.equal(r.text, 'ok');
    assert.equal(letture, 1);
    assert.deepEqual(chiamateVere().map((c) => c.key), ['sk-personal']);
    for (const m of [WIZARD, `${WIZARD}:free`, 'ACME/Altro-Aperto-70B']) assert.equal(C.creditsAllowModel(m), true, m);
    for (const m of ['acme/chiuso-pro', 'acme/chiuso-plus', CHIUSO]) assert.equal(C.creditsAllowModel(m), false, m);
    assert.equal(C.isOpenWeightsModelId(WIZARD), true, 'l’interruttore dei pesi aperti legge lo stesso catalogo');

    // Un chiuso resta fermato anche dopo la lettura, e senza chiamate al router.
    calls = [];
    await assert.rejects(OR.complete({ apiKey: 'sk-personal', model: 'acme/chiuso-pro', messages: [] }), (e) => e.reason === 'crediti');
    assert.equal(chiamateVere().length, 0);
    // Un catalogo che non si legge non apre niente.
    C.registraCatalogoPesi([]);
    C.registraCaricatoreCatalogo(async () => { throw new Error('rete'); });
    await assert.rejects(OR.complete({ apiKey: 'sk-personal', model: WIZARD, messages: [] }), (e) => e.reason === 'crediti');
  } finally {
    C.registraCatalogoPesi([]);
    C.registraCaricatoreCatalogo(null);
  }
});

test('i pesi dichiarati da una voce valgono solo per il suo modello: cambiato il modello di una riga, la dichiarazione non lo segue', () => {
  const voce = { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', weights: 'open', inputs: ['text'], outputs: ['text'] };
  assert.deepEqual(C.dichiarazioniPerModello(voce, 'deepseek/deepseek-v4-flash'), { weights: 'open', inputs: ['text'], outputs: ['text'] });
  assert.deepEqual(C.dichiarazioniPerModello(voce, CHIUSO), {});
  assert.deepEqual(C.dichiarazioniPerModello(null, CHIUSO), {});
  assert.equal(C.pesiDichiaratiPer(voce, CHIUSO), '');
  assert.equal(C.pesiDichiaratiPer(voce, ' DeepSeek/deepseek-v4-flash '), 'open');

  // Il registro personale salvato prima della regola: una riga a cui si è già cambiato il modello perde la
  // dichiarazione; una che parla dello stesso modello del registro condiviso la tiene.
  const condiviso = { 'deepseek-flash': voce, gemma: { provider: 'openrouter', model: 'google/gemma-4-31b-it', weights: 'open' } };
  const personale = {
    'deepseek-flash': { provider: 'openrouter', model: CHIUSO, weights: 'open' },
    mia: { provider: 'openrouter', model: 'google/gemma-4-31b-it', weights: 'open' },
    altra: { provider: 'openrouter', model: 'acme/x', weights: 'open' },
    senza: { provider: 'openrouter', model: APERTO },
  };
  const letto = C.registroConPesiCondivisi(personale, condiviso);
  assert.equal(letto['deepseek-flash'].weights, undefined);
  assert.equal(letto.mia.weights, 'open');
  assert.equal(letto.altra.weights, undefined, 'chi usa Filo non dichiara pesi da sé');
  assert.deepEqual(letto.senza, personale.senza);
  assert.equal(C.creditsAllowModel(letto['deepseek-flash'].model, letto['deepseek-flash'].weights), false);
  const pulito = { mia: personale.mia };
  assert.equal(C.registroConPesiCondivisi(pulito, condiviso), pulito, 'niente da togliere: lo stesso oggetto');
});
