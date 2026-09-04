// Unit test per #422 — la misura del RIUSO del testo in ingresso.
//
// Tenere le istruzioni fisse in testa serve a far riusare quel pezzo di prompt
// dal fornitore invece di farlo ricalcolare a ogni messaggio. Senza un numero
// che lo dica, "riuso pieno" e "riuso zero" sono indistinguibili: entrambi i
// fornitori che Filo usa davvero riportano quanti token hanno riusato, e qui
// verifichiamo che quel dato venga raccolto (non-streaming e streaming) e che
// arrivi fino alla cronologia, dove l'utente lo legge.
//
// Senza il fix questi assert falliscono: l'oggetto usage conteneva solo
// promptTokens/completionTokens e il numero del riuso veniva buttato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'openrouter.js'));
const OpenRouter = globalThis.SN_PROVIDER_OPENROUTER;

function jsonResponse(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => '' };
}
function withFetch(fn, run) {
  const orig = global.fetch;
  global.fetch = fn;
  return Promise.resolve(run()).finally(() => { global.fetch = orig; });
}
function sseResponse(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  const body = {
    getReader() {
      return {
        read() {
          if (i >= chunks.length) return Promise.resolve({ done: true, value: undefined });
          return Promise.resolve({ done: false, value: enc.encode(chunks[i++]) });
        },
      };
    },
  };
  return { ok: true, body, status: 200, text: async () => '' };
}

// ── OpenRouter ───────────────────────────────────────────────────────────────

test('OpenRouter: i token riusati dalla cache finiscono nel conteggio', async () => {
  const res = await withFetch(
    () => Promise.resolve(jsonResponse({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 7000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 6400 } },
    })),
    () => OpenRouter.complete({ apiKey: 'k', model: 'x/y', messages: [{ role: 'user', content: 'ciao' }] }),
  );
  assert.equal(res.usage.promptTokens, 7000);
  assert.equal(res.usage.cachedPromptTokens, 6400);
});

test('OpenRouter: nessun riuso riportato → zero, non "sconosciuto"', async () => {
  const res = await withFetch(
    () => Promise.resolve(jsonResponse({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 7000, completion_tokens: 50 },
    })),
    () => OpenRouter.complete({ apiKey: 'k', model: 'x/y', messages: [{ role: 'user', content: 'ciao' }] }),
  );
  assert.equal(res.usage.cachedPromptTokens, 0);
});

test('OpenRouter streaming: il riuso arriva col conteggio finale', async () => {
  const chunks = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n\n',
    'data: ' + JSON.stringify({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 6100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 5800 } },
    }) + '\n\n',
    'data: [DONE]\n\n',
  ];
  const res = await withFetch(
    () => Promise.resolve(sseResponse(chunks)),
    () => OpenRouter.streamComplete({ apiKey: 'k', model: 'x/y', messages: [{ role: 'user', content: 'x' }], onDelta: () => {} }),
  );
  assert.equal(res.usage.promptTokens, 6100);
  assert.equal(res.usage.cachedPromptTokens, 5800);
});

// ── Gemini ───────────────────────────────────────────────────────────────────



// ── Il dato sopravvive fino alla cronologia ──────────────────────────────────

test('cronologia: il conteggio del riuso viene salvato con la voce', async () => {
  const store = {};
  global.chrome = {
    storage: {
      local: {
        get: async (k) => ({ [k]: store[k] }),
        set: async (o) => { Object.assign(store, o); },
      },
    },
  };
  require(join(ROOT, 'src', 'main', 'services', 'historyStore.js'));
  const H = globalThis.SN_HISTORY;
  await H.clear();
  await H.append({
    action: 'filo_chat', provider: 'gemini', model: 'gemini-3.1-flash-lite',
    input: {}, output: 'ciao',
    usage: { promptTokens: 8000, completionTokens: 30, cachedPromptTokens: 6400 },
  });
  const items = await H.list();
  assert.equal(items[0].usage.cachedPromptTokens, 6400);
  assert.equal(items[0].usage.promptTokens, 8000);
});
