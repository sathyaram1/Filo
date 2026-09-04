// Unit test per l'handler test_default_model (src/main/services/handlers/ai.js).
//
// Bug coperto: il "Prova" dell'editor admin "Modelli predefiniti" cercava il
// nickname nel registry GIÀ SALVATO, quindi su una riga appena scritta falliva
// con «Modello "X" non trovato». Ora il messaggio accetta { provider, model }
// espliciti (riga testata così com'è scritta, solo admin) e — per i nickname —
// risolve nel registry PREDEFINITO (costanti + override Firestore), non nei
// settings personali dell'utente.
//
// L'handler è registrato via register(on, ctx): qui lo carichiamo con `on` e
// `ctx` finti, e stubbiamo SN_PROVIDERS.streamComplete per catturare con quale
// provider/modello/chiave verrebbe chiamata l'API. Niente rete, niente Electron.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Moduli condivisi reali (IIFE su globalThis): costanti e messaggi.
require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
// Modelli di prova: l'app non ha più modelli scritti nel codice.
require(join(__dirname, '..', 'fixtures', 'testModels.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'messages.js'));
// Come nel main (loader.js): serve alla sostituzione a pesi aperti per sapere
// se il sostituto fa il mestiere della funzione.
require(join(__dirname, '..', '..', 'src', 'shared', 'modelCaps.js'));
const { MSG } = globalThis.SN_MSG;

// ── harness: registra l'handler con dipendenze finte ────────────────────────

const registerAi = require(join(__dirname, '..', '..', 'src', 'main', 'services', 'handlers', 'ai.js'));

// Stato manipolato dai singoli test.
const state = {
  admin: false,
  defaults: { modelRegistry: {}, apiKeys: {} },
  effective: { modelRegistry: {}, apiKeys: {} },
  calls: [],            // chiamate catturate a streamComplete
  streamError: null,    // se valorizzato, streamComplete lancia
  emptyStream: false,   // se true, lo stream finisce senza contenuto
};

globalThis.SN_PROVIDERS = {
  streamComplete: async ({ provider, apiKey, model, messages, providerRouting, onDelta }) => {
    state.calls.push({ provider, apiKey, model, providerRouting });
    if (state.streamError) throw new Error(state.streamError);
    if (state.emptyStream) return { usage: { completionTokens: 0 } };
    onDelta('1, 2, 3');
    return { usage: { completionTokens: 7 } };
  },
};

const handlers = new Map();
registerAi((type, fn) => handlers.set(type, fn), {
  MSG,
  getEffectiveSettings: async () => state.effective,
  Defaults: {
    refreshIfStale: async () => state.defaults,
    get: () => state.defaults,
  },
  isAdmin: () => state.admin,
  handleAIRequest: async () => ({}),
  modelForAction: (s, action) => ((s && s.models) || {})[action] || '',
  buildAttemptChain: () => [],
  // Le stesse due funzioni che il main passa all'handler. La classificazione è
  // quella VERA (logica pura in constants.js): qui è finto solo il testo del
  // messaggio, che nei unit test non c'è (I18n vive nel main).
  openWeightsBlockReason: (settings, entry) => {
    const kind = globalThis.SN_CONST.openWeightsBlockKind(
      settings && settings.openWeightsOnly === true, entry,
    );
    return kind ? `bloccato: ${kind}` : null;
  },
  providerRouting: (settings) => {
    const ignore = globalThis.SN_CONST.providerIgnoreList((settings && settings.excludedProviders) || []);
    return ignore.length ? { ignore } : null;
  },
});

const testModel = (msg) => handlers.get(MSG.TEST_DEFAULT_MODEL)(msg);
const testProvider = (msg) => handlers.get(MSG.TEST_PROVIDER)(msg);

beforeEach(() => {
  state.admin = false;
  state.defaults = { modelRegistry: {}, apiKeys: {} };
  state.effective = { modelRegistry: {}, apiKeys: {} };
  state.calls = [];
  state.streamError = null;
  state.emptyStream = false;
});

// ── { provider, model } espliciti: riga dell'editor admin, anche non salvata ─

test('riga non ancora salvata: admin testa provider+modello espliciti (il nickname non serve nel registry)', async () => {
  state.admin = true;
  state.defaults.apiKeys = { openrouter: 'sk-or-default' };
  const res = await testModel({
    nickname: 'gemma31', provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  });
  assert.equal(res.ok, true, `atteso ok, ottenuto: ${res.error}`);
  assert.equal(state.calls.length, 1);
  // Chiama l'API col MODELLO scritto nella riga (non col nickname) e la chiave predefinita.
  assert.equal(state.calls[0].model, 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.equal(state.calls[0].provider, 'openrouter');
  assert.equal(state.calls[0].apiKey, 'sk-or-default');
});

test('riga esplicita da non-admin: rifiutata senza chiamare il provider', async () => {
  state.admin = false;
  state.defaults.apiKeys = { openrouter: 'sk-or-default' };
  const res = await testModel({ provider: 'openrouter', model: 'qualcosa/x' });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /amministrator/i);
  assert.equal(state.calls.length, 0);
});

test('stream concluso senza contenuto → ok:false "risposto vuoto" (capita su alcuni endpoint :free)', async () => {
  state.admin = true;
  state.defaults.apiKeys = { openrouter: 'sk-or-default' };
  state.emptyStream = true;
  const res = await testModel({ provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /vuoto/i);
});

test('errore del provider propagato come ok:false (es. modello inesistente su OpenRouter)', async () => {
  state.admin = true;
  state.defaults.apiKeys = { openrouter: 'sk-or-default' };
  state.streamError = 'No endpoints found';
  const res = await testModel({ provider: 'openrouter', model: 'finto/modello' });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /No endpoints found/);
});

// ── { nickname }: lista read-only delle Opzioni ──────────────────────────────

test('nickname risolto nel registry PREDEFINITO anche se i settings utente non lo contengono (useDefaultModels OFF)', async () => {
  state.defaults.modelRegistry = { 'flash-lite': { provider: 'gemini', model: 'gemini-3.1-flash-lite' } };
  state.defaults.apiKeys = { gemini: 'AIza-default' };
  // I settings effettivi dell'utente NON contengono il nickname (registry personale).
  state.effective = { modelRegistry: { mio: { provider: 'openrouter', model: 'x' } }, apiKeys: {} };
  const res = await testModel({ nickname: 'flash-lite' });
  assert.equal(res.ok, true, `atteso ok, ottenuto: ${res.error}`);
  assert.equal(state.calls[0].model, 'gemini-3.1-flash-lite');
  assert.equal(state.calls[0].provider, 'gemini');
  assert.equal(state.calls[0].apiKey, 'AIza-default');
});

test('nickname con vecchio schema duale { openrouter: id } risolto correttamente', async () => {
  state.defaults.modelRegistry = { vecchio: { openrouter: 'meta/llama-3-8b' } };
  state.defaults.apiKeys = { openrouter: 'sk-or-default' };
  const res = await testModel({ nickname: 'vecchio' });
  assert.equal(res.ok, true, `atteso ok, ottenuto: ${res.error}`);
  assert.equal(state.calls[0].model, 'meta/llama-3-8b');
  assert.equal(state.calls[0].provider, 'openrouter');
});

test('nickname inesistente → "non trovato", senza chiamare il provider', async () => {
  state.defaults.modelRegistry = { altro: { provider: 'openrouter', model: 'x' } };
  const res = await testModel({ nickname: 'gemma31' });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /non trovato/);
  assert.equal(state.calls.length, 0);
});

// ── precedenza chiavi: predefinita prima, personale come fallback ───────────

test('chiave predefinita preferita; fallback alla chiave personale se i default non ne hanno', async () => {
  state.admin = true;
  // Default senza chiave openrouter → si usa quella personale effettiva.
  state.effective.apiKeys = { openrouter: 'sk-or-personale' };
  let res = await testModel({ provider: 'openrouter', model: 'a/b' });
  assert.equal(res.ok, true, `atteso ok, ottenuto: ${res.error}`);
  assert.equal(state.calls[0].apiKey, 'sk-or-personale');

  // Con la chiave predefinita presente, vince lei.
  state.defaults.apiKeys = { openrouter: 'sk-or-default' };
  res = await testModel({ provider: 'openrouter', model: 'a/b' });
  assert.equal(state.calls[1].apiKey, 'sk-or-default');
});

test('nessuna chiave da nessuna parte → errore esplicito', async () => {
  state.admin = true;
  const res = await testModel({ provider: 'openrouter', model: 'a/b' });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /[Cc]hiave/);
});

// ── "Solo modelli a pesi aperti" (#461): il "Prova" è una chiamata VERA ──────
// Il pulsante sta nella stessa pagina dove si accende l'interruttore: se lui
// solo potesse chiamare un modello proprietario, l'interruttore non varrebbe
// niente proprio dove lo si accende. Senza il cancello questi test falliscono:
// la chiamata parte e finisce in state.calls.

test('interruttore acceso: il "Prova" di un modello proprietario NON chiama niente', async () => {
  state.effective = { modelRegistry: {}, apiKeys: {}, openWeightsOnly: true };
  state.defaults.apiKeys = { openrouter: 'sk-or-default', gemini: 'AIza-default' };
  state.defaults.modelRegistry = {
    'claude-haiku': { provider: 'openrouter', model: 'anthropic/claude-3.5-haiku' },
    tts: { provider: 'gemini', model: 'gemini-2.5-flash-preview-tts' },
    'embed-004': { provider: 'gemini', model: 'text-embedding-004' },
    gemma: { provider: 'openrouter', model: 'google/gemma-4-31b-it', weights: 'open' },
  };

  for (const nickname of ['claude-haiku', 'tts', 'embed-004']) {
    const res = await testModel({ nickname });
    assert.equal(res.ok, false, `"${nickname}" non doveva partire`);
    assert.match(String(res.error), /bloccato:/);
  }
  assert.equal(state.calls.length, 0, 'nessuna richiesta deve essere partita');

  // Il modello a pesi aperti invece si prova: il cancello non spegne tutto.
  const ok = await testModel({ nickname: 'gemma' });
  assert.equal(ok.ok, true, `atteso ok, ottenuto: ${ok.error}`);
  assert.equal(state.calls.length, 1);
});

test('interruttore acceso: se l\'owner ha classificato la voce come aperta, la prova parte', async () => {
  // Stessa classificazione che vale per le richieste vere: se il cancello delle
  // prove guardasse solo la stringa del modello, l'owner potrebbe correggere una
  // classificazione sbagliata per le funzioni ma non per il pulsante che le
  // prova.
  state.effective = { modelRegistry: {}, apiKeys: {}, openWeightsOnly: true };
  state.defaults.apiKeys = { openrouter: 'sk-or-default' };
  state.defaults.modelRegistry = {
    nuovo: { provider: 'openrouter', model: 'acme/modello-nuovo', weights: 'open' },
  };
  const res = await testModel({ nickname: 'nuovo' });
  assert.equal(res.ok, true, `atteso ok, ottenuto: ${res.error}`);
});

test('interruttore acceso: nemmeno la riga scritta a mano dall\'amministratore passa', async () => {
  state.admin = true;
  state.effective = { modelRegistry: {}, apiKeys: {}, openWeightsOnly: true };
  state.defaults.apiKeys = { openrouter: 'sk-or-default' };
  const res = await testModel({ provider: 'openrouter', model: 'anthropic/claude-3.7-sonnet' });
  assert.equal(res.ok, false);
  assert.equal(state.calls.length, 0);
});

// ── Stesso cancello per il "Prova" accanto alle CHIAVI (test_provider) ───────

test('interruttore acceso: la prova della chiave parte sul sostituto a pesi aperti', async () => {
  const C = globalThis.SN_CONST;
  state.effective = {
    modelRegistry: globalThis.SN_TEST_MODELS.registry,
    models: { [C.ACTIONS.PROVIDER_TEST]: globalThis.SN_TEST_MODELS.models[C.ACTIONS.PROVIDER_TEST] },
    apiKeys: {},
    openWeightsOnly: true,
  };
  const res = await testProvider({ provider: 'openrouter', apiKey: 'sk-or-utente' });
  assert.equal(res.ok, true, `atteso ok, ottenuto: ${res.error}`);
  assert.equal(state.calls.length, 1);
  const primo = C.parseModelRefs(globalThis.SN_TEST_MODELS.models[C.ACTIONS.PROVIDER_TEST])[0];
  assert.ok(C.isOpenWeightsRef(primo, globalThis.SN_TEST_MODELS.registry), 'il modello della prova è a pesi aperti');
  assert.equal(state.calls[0].model, globalThis.SN_TEST_MODELS.registry[primo].model,
    'la prova doveva usare un modello a pesi aperti, non uno proprietario');
});

test('interruttore acceso: la prova su un modello proprietario scritto a mano non parte', async () => {
  state.effective = { modelRegistry: {}, apiKeys: {}, openWeightsOnly: true };
  const res = await testProvider({
    provider: 'openrouter', apiKey: 'sk-or-utente', model: 'anthropic/claude-3.5-haiku',
  });
  assert.equal(res.ok, false);
  assert.equal(state.calls.length, 0);

  // E il fornitore che è l'API del produttore resta spento in blocco.
  const gem = await testProvider({ provider: 'gemini', apiKey: 'AIza-utente' });
  assert.equal(gem.ok, false);
  assert.equal(state.calls.length, 0);
});

test('la prova porta con sé chi NON deve servirla (lista di esclusione)', async () => {
  state.admin = true;
  state.effective = { modelRegistry: {}, apiKeys: {}, excludedProviders: ['Google', 'OpenAI'] };
  state.defaults.apiKeys = { openrouter: 'sk-or-default' };
  const res = await testModel({ provider: 'openrouter', model: 'google/gemma-4-31b-it' });
  assert.equal(res.ok, true, `atteso ok, ottenuto: ${res.error}`);
  const ignore = (state.calls[0].providerRouting || {}).ignore || [];
  assert.ok(ignore.length, 'la prova partiva senza dire chi è escluso');
});
