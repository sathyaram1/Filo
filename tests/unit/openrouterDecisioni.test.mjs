// I classificatori (Jev) passano dall'endpoint delle decisioni del router, non dalla chat (#1118): forma della
// richiesta, lettura delle risposte e del costo, l'attesa chiesta da un 429, e la lista di esclusione che viaggia.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'openrouter.js'));
const OR = globalThis.SN_PROVIDER_OPENROUTER;

function jsonRes(obj, headers = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
    clone() { return this; },
    async json() { return obj; },
    async text() { return JSON.stringify(obj); },
  };
}

async function withFetch(impl, run) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    const u = String(url);
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, body, headers: (init && init.headers) || {} });
    // Coi crediti di Filo il classificatore parte solo se i suoi host dichiarano la ritenzione zero (#831).
    if (u === OR.ZDR_ENDPOINT) return jsonRes({ data: [{ model_id: 'typesafe/jev-1.13', provider_name: 'TypeSafe', tag: 'typesafe' }] });
    if (u.includes('/endpoints')) return jsonRes({ data: { endpoints: [{ provider_name: 'TypeSafe', tag: 'typesafe' }] } });
    return impl({ url: u, body });
  };
  try { return await run(calls); } finally { global.fetch = real; OR.forgetModelHosts(); }
}

const DOMANDE = { f1: { type: 'noul', instructions: 'È lui?', criteria: { true: 'sì', false: 'no' } } };

test('la richiesta va all\'endpoint delle decisioni con modello, stato, domande e lista di esclusione', async () => {
  await withFetch(() => jsonRes({
    model: 'typesafe/jev-1.13-20260917',
    answers: { f1: { type: 'noul', noul: 0.91 } },
    usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
  }), async (calls) => {
    const r = await OR.decisions({
      apiKey: 'k', model: 'typesafe/jev-1.13', state: { ricerca: 'x' }, questions: DOMANDE,
      providerRouting: { ignore: ['Google', 'OpenAI'] },
    });
    const call = calls.find((c) => c.url === OR.DECISIONS_ENDPOINT);
    assert.ok(call, 'la chiamata non è andata all\'endpoint delle decisioni');
    assert.equal(OR.DECISIONS_ENDPOINT, 'https://openrouter.ai/api/alpha/decisions');
    assert.equal(call.body.model, 'typesafe/jev-1.13');
    assert.deepEqual(call.body.state, { ricerca: 'x' });
    assert.deepEqual(call.body.questions, DOMANDE);
    assert.deepEqual(call.body.provider.ignore, ['Google', 'OpenAI']);
    assert.equal(call.headers.Authorization, 'Bearer k');
    assert.deepEqual(r.answers, { f1: { type: 'noul', noul: 0.91 } });
    assert.equal(r.model, 'typesafe/jev-1.13-20260917');
    assert.equal(r.usage.promptTokens, 476);
    assert.equal(r.usage.completionTokens, 70);
    assert.ok(Math.abs(r.usage.costUsd - 0.000019992) < 1e-12);
    // Senza il campo della cache l'host non l'ha detta (#1464): per i contatori è «nd», non uno zero.
    assert.deepEqual([r.usage.cachedPromptTokens, r.usage.cacheDetta], [0, false]);
  });
});

test('la cache letta dal classificatore si conta come nelle chat (#1464)', async () => {
  await withFetch(() => jsonRes({
    answers: { f1: { type: 'noul', noul: 0.4 } },
    usage: { input_tokens: 3000, output_tokens: 3, prompt_tokens_details: { cached_tokens: 2500 }, cost: 0.0001 },
  }), async () => {
    const r = await OR.decisions({ apiKey: 'k', model: 'typesafe/jev-1.13', state: 's', questions: DOMANDE });
    assert.deepEqual([r.usage.cachedPromptTokens, r.usage.cacheDetta], [2500, true]);
  });
});

test('un 429 porta l\'attesa chiesta dal router, e lo stato per chi decide se riprovare', async () => {
  await withFetch(() => jsonRes({ error: { message: 'rate limited' } }, { 'retry-after': '3' }, 429), async () => {
    await assert.rejects(
      OR.decisions({ apiKey: 'k', model: 'typesafe/jev-1.13', state: 's', questions: DOMANDE }),
      (e) => e.status === 429 && e.retryAfterMs === 3000 && e.provider === 'openrouter',
    );
  });
});

test('un host escluso per tutti gli host del modello ferma la richiesta prima di partire', async () => {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/endpoints')) return jsonRes({ data: { endpoints: [{ provider_name: 'Google', tag: 'google' }] } });
    return jsonRes({ answers: {} });
  };
  try {
    await assert.rejects(
      OR.decisions({ apiKey: 'k', model: 'vendor/classificatore', state: 's', questions: DOMANDE, providerRouting: { ignore: ['Google'] } }),
      (e) => e.code === 'NO_ALLOWED_HOST',
    );
    assert.ok(!calls.includes(OR.DECISIONS_ENDPOINT), 'la richiesta non deve partire verso un host escluso');
  } finally { global.fetch = real; OR.forgetModelHosts(); }
});
