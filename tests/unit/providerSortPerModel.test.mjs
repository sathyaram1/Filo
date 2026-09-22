// Ordinamento degli host scelto per modello, accanto al livello di reasoning.
// La voce vince sul globale, un valore ignoto vale «automatico», e la lista di
// esclusione viaggia identica qualunque ordinamento si scelga.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require(join(__dirname, '..', '..', 'src', 'shared', 'constants.js'));
const C = globalThis.SN_CONST;
require(join(__dirname, '..', '..', 'src', 'main', 'services', 'providers', 'openrouter.js'));
const OpenRouter = globalThis.SN_PROVIDER_OPENROUTER;

const KEYS = { openrouter: 'k' };

function withFetch(fn, run) {
  const orig = global.fetch;
  global.fetch = fn;
  return Promise.resolve(run()).finally(() => { global.fetch = orig; });
}
function jsonResponse() {
  return {
    ok: true, status: 200, text: async () => '',
    json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
  };
}
function sseResponse() {
  const enc = new TextEncoder();
  const chunks = ['data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n\n', 'data: [DONE]\n\n'];
  let i = 0;
  const body = {
    getReader: () => ({
      read: () => Promise.resolve(i >= chunks.length
        ? { done: true, value: undefined }
        : { done: false, value: enc.encode(chunks[i++]) }),
    }),
  };
  return { ok: true, status: 200, body, text: async () => '' };
}

// Il corpo che parte davvero verso il router, per un tentativo della catena.
async function bodyFor(attempt, { stream = false, onReasoning } = {}) {
  let sent = null;
  await withFetch(
    (url, opts) => { sent = JSON.parse(opts.body); return Promise.resolve(stream ? sseResponse() : jsonResponse()); },
    () => (stream
      ? OpenRouter.streamComplete({
        apiKey: attempt.apiKey, model: attempt.model, reasoning: attempt.reasoning,
        providerRouting: attempt.providerRouting, messages: [{ role: 'user', content: 'x' }],
        onDelta: () => {}, onReasoning,
      })
      : OpenRouter.complete({
        apiKey: attempt.apiKey, model: attempt.model, reasoning: attempt.reasoning,
        providerRouting: attempt.providerRouting, messages: [{ role: 'user', content: 'x' }],
      })),
  );
  return sent;
}

test('normalizeProviderSort: valori noti, e tutto il resto è automatico', () => {
  assert.equal(C.normalizeProviderSort(undefined), null);
  assert.equal(C.normalizeProviderSort(''), null);
  assert.equal(C.normalizeProviderSort('auto'), null);
  assert.equal(C.normalizeProviderSort(' Throughput '), 'throughput');
  assert.equal(C.normalizeProviderSort('LATENCY'), 'latency');
  assert.equal(C.normalizeProviderSort('price'), 'price');
  assert.equal(C.normalizeProviderSort('fastest'), null);
  assert.equal(C.normalizeProviderSort({}), null);
});

test('buildModelAttempts: il tentativo porta l\'ordinamento della sua voce', () => {
  const registry = {
    svelto: { provider: 'openrouter', model: 'x/svelto', sort: 'throughput' },
    normale: { provider: 'openrouter', model: 'x/normale' },
    auto: { provider: 'openrouter', model: 'x/auto', sort: 'auto' },
    storto: { provider: 'openrouter', model: 'x/storto', sort: 'boh' },
  };
  const out = C.buildModelAttempts(['svelto', 'normale', 'auto', 'storto'], registry, ['openrouter'], KEYS);
  assert.equal(out.length, 4);
  assert.equal(out[0].sort, 'throughput');
  for (const a of out.slice(1)) assert.ok(!('sort' in a), `${a.model} non doveva portare un ordinamento`);
});

test('providerRoutingFor: la voce vince sul globale, senza voce vale il globale', () => {
  const settings = { excludedProviders: ['Google', 'OpenAI'], providerSort: 'price' };
  assert.equal(C.providerRoutingFor(settings, 'throughput').sort, 'throughput');
  assert.equal(C.providerRoutingFor(settings, '').sort, 'price');
  assert.equal(C.providerRoutingFor(settings, 'auto').sort, 'price');
  assert.equal(C.providerRoutingFor(settings, 'boh').sort, 'price');
  // Senza globale e senza voce non si manda nessun ordinamento: decide il router.
  assert.ok(!('sort' in C.providerRoutingFor({ excludedProviders: ['Google'] }, '')));
  assert.equal(C.providerRoutingFor({}, ''), null);
  assert.deepEqual(C.providerRoutingFor({}, 'latency'), { sort: 'latency' });
});

test('providerRoutingFor: la lista di esclusione è identica con qualunque ordinamento', () => {
  const settings = { excludedProviders: ['Google', 'google', ' OpenAI ', '', 'Z.ai'] };
  const base = C.providerRoutingFor(settings, '').ignore;
  assert.deepEqual(base, ['Google', 'OpenAI', 'Z.ai']);
  for (const sort of ['price', 'throughput', 'latency', 'auto', 'boh', 'ignore', '__proto__']) {
    assert.deepEqual(C.providerRoutingFor(settings, sort).ignore, base, `ignore cambiato con sort=${sort}`);
  }
});

test('nel corpo della richiesta: sort della voce e ignore intatto, con e senza streaming', async () => {
  const settings = { excludedProviders: ['Google', 'OpenAI'], providerSort: 'price' };
  const registry = {
    svelto: { provider: 'openrouter', model: 'x/svelto', sort: 'throughput' },
    normale: { provider: 'openrouter', model: 'x/normale' },
  };
  const attempts = C.buildModelAttempts(['svelto', 'normale'], registry, ['openrouter'], KEYS)
    .map((a) => ({ ...a, providerRouting: C.providerRoutingFor(settings, a.sort) }));

  for (const stream of [false, true]) {
    const svelto = await bodyFor(attempts[0], { stream });
    const normale = await bodyFor(attempts[1], { stream });
    assert.equal(svelto.provider.sort, 'throughput');
    assert.equal(normale.provider.sort, 'price');
    assert.deepEqual(svelto.provider.ignore, ['Google', 'OpenAI']);
    assert.deepEqual(svelto.provider.ignore, normale.provider.ignore);
  }
});

// Il livello scelto sulla voce decide il campo `reasoning` in ogni cammino; chiedere
// anche i pensieri in streaming aggiunge `enabled`, e non tocca mai il livello.
test('nel corpo della richiesta: il livello di reasoning della voce, con e senza pensieri in streaming', async () => {
  const attese = {
    off: { piano: { enabled: false }, pensieri: { enabled: false } },
    low: { piano: { effort: 'low' }, pensieri: { effort: 'low', enabled: true } },
    medium: { piano: { effort: 'medium' }, pensieri: { effort: 'medium', enabled: true } },
    high: { piano: { effort: 'high' }, pensieri: { effort: 'high', enabled: true } },
    auto: { piano: undefined, pensieri: { enabled: true } },
  };
  for (const [level, atteso] of Object.entries(attese)) {
    const registry = { m: { provider: 'openrouter', model: 'x/m', reasoning: level } };
    const [a] = C.buildModelAttempts(['m'], registry, ['openrouter'], KEYS);
    assert.deepEqual((await bodyFor(a)).reasoning, atteso.piano, `complete, ${level}`);
    assert.deepEqual((await bodyFor(a, { stream: true })).reasoning, atteso.piano, `stream senza pensieri, ${level}`);
    assert.deepEqual(
      (await bodyFor(a, { stream: true, onReasoning: () => {} })).reasoning, atteso.pensieri,
      `stream con pensieri, ${level}`,
    );
  }
});

// La scelta generale si scrive a mano nella config condivisa: una maiuscola o
// uno spazio non devono farla sparire in silenzio, come non la fanno sparire
// sulla voce del singolo modello.
test('la scelta generale regge maiuscole e spazi, e un valore ignoto vale «nessun ordine»', () => {
  const casi = [
    ['Price', 'price'],
    ['  throughput  ', 'throughput'],
    ['LATENCY', 'latency'],
    ['auto', undefined],
    ['', undefined],
    ['pippo', undefined],
  ];
  for (const [scritto, atteso] of casi) {
    const r = C.providerRoutingFor({ excludedProviders: ['Google'], providerSort: scritto }, null);
    assert.equal(r && r.sort, atteso, `scelta generale «${scritto}»`);
    assert.deepEqual(r.ignore, ['Google'], `la lista di esclusione non dipende da «${scritto}»`);
  }
  // E la voce continua a vincere, comunque sia scritta la generale.
  const r = C.providerRoutingFor({ excludedProviders: [], providerSort: 'Price' }, 'throughput');
  assert.equal(r.sort, 'throughput');
});
