// #331 — "il modello ha incontrato un errore. non so cosa significhi 400":
// quando un provider AI risponde con un errore HTTP, l'errore lanciato deve
// portare `status` e `provider` STRUTTURATI, così chi lo mostra all'utente
// (es. la chat dei mazzi) può tradurlo in una frase comprensibile invece di
// far arrivare in chat il codice grezzo. Senza il fix (Error col solo
// messaggio "OpenRouter 400: …") questi assert diventano rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require(join(__dirname, '..', '..', 'src', 'main', 'services', 'providers', 'openrouter.js'));
require(join(__dirname, '..', '..', 'src', 'main', 'services', 'providers', 'gemini.js'));
const OpenRouter = globalThis.SN_PROVIDER_OPENROUTER;
const Gemini = globalThis.SN_PROVIDER_GEMINI;

function withFakeFetch(impl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve(run()).finally(() => { globalThis.fetch = orig; });
}

function httpError(status, bodyText) {
  return async () => ({
    ok: false,
    status,
    body: null,
    text: async () => bodyText,
    json: async () => { throw new Error('not json'); },
  });
}

test('OpenRouter complete: errore HTTP porta status e provider strutturati', async () => {
  await withFakeFetch(httpError(400, 'Bad Request — invalid model'), async () => {
    await assert.rejects(
      OpenRouter.complete({ apiKey: 'k', model: 'm', messages: [] }),
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.provider, 'openrouter');
        assert.match(err.message, /invalid model/);
        return true;
      },
    );
  });
});

test('OpenRouter streamComplete: errore HTTP porta status e provider strutturati', async () => {
  await withFakeFetch(httpError(503, 'Service Unavailable'), async () => {
    await assert.rejects(
      OpenRouter.streamComplete({ apiKey: 'k', model: 'm', messages: [] }),
      (err) => {
        assert.equal(err.status, 503);
        assert.equal(err.provider, 'openrouter');
        return true;
      },
    );
  });
});

test('Gemini complete: errore HTTP porta status e provider strutturati', async () => {
  await withFakeFetch(httpError(429, 'quota exceeded'), async () => {
    await assert.rejects(
      Gemini.complete({ apiKey: 'k', model: 'gemini-2.5-flash', messages: [] }),
      (err) => {
        assert.equal(err.status, 429);
        assert.equal(err.provider, 'gemini');
        return true;
      },
    );
  });
});

test('Gemini streamComplete: errore HTTP porta status e provider strutturati', async () => {
  await withFakeFetch(httpError(500, 'internal'), async () => {
    await assert.rejects(
      Gemini.streamComplete({ apiKey: 'k', model: 'gemini-2.5-flash', messages: [] }),
      (err) => {
        assert.equal(err.status, 500);
        assert.equal(err.provider, 'gemini');
        return true;
      },
    );
  });
});

test('Gemini: modello non Google → errore marcato come errore provider (senza status)', async () => {
  await assert.rejects(
    Gemini.complete({ apiKey: 'k', model: 'anthropic/claude', messages: [] }),
    (err) => {
      assert.equal(err.provider, 'gemini');
      assert.equal(err.status, undefined);
      return true;
    },
  );
});
