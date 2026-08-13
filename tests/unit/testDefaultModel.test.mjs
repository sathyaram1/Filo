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
require(join(__dirname, '..', '..', 'src', 'shared', 'messages.js'));
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
  streamComplete: async ({ provider, apiKey, model, messages, onDelta }) => {
    state.calls.push({ provider, apiKey, model });
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
  modelForAction: () => '',
  buildAttemptChain: () => [],
  // Le stesse due funzioni che il main passa all'handler. La classificazione è
  // quella VERA (logica pura in constants.js): qui è finto solo il testo del
  // messaggio, che nei unit test non c'è (I18n vive nel main).
  openWeightsBlockReason: (settings, provider, model) => {
    const kind = globalThis.SN_CONST.openWeightsBlockKind(
      settings && settings.openWeightsOnly === true, provider, model,
    );
    return kind ? `bloccato: ${kind}` : null;
  },
  providerRouting: (settings) => {
    const ignore = globalThis.SN_CONST.providerIgnoreList((settings && settings.excludedProviders) || []);
    return ignore.length ? { ignore } : null;
  },
});

const testModel = (msg) => handlers.get(MSG.TEST_DEFAULT_MODEL)(msg);

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
