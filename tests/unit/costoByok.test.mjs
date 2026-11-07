// #1582: una chiamata servita con la chiave del fornitore che l'owner ha dato a OpenRouter (BYOK) costa la commissione
// del router più quello che il fornitore fa pagare a parte; è quel totale che il tetto della chiave personale conta, e
// quindi quello che la riga del registro d'uso deve dire. Senza il segno BYOK il costo resta quello del router.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'wallet', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri', 'chatErrors']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
require(join(ROOT, 'src', 'main', 'services', 'modelGate.js'));
require(join(ROOT, 'src', 'main', 'services', 'providers', 'openrouter.js'));
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const W = globalThis.SN_WALLET;

const CLAUDE = 'anthropic/claude-haiku-4.5';
const vicino = (a, b) => Math.abs(a - b) < 1e-12;

function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = orig; });
}
function sse(events) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) { for (const e of events) c.enqueue(enc.encode(`data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`)); c.close(); },
  });
}

const BYOK = { prompt_tokens: 1000, completion_tokens: 200, cost: 0, is_byok: true, cost_details: { upstream_inference_cost: 0.002 } };

for (const metodo of ['complete', 'streamComplete']) {
  const risposta = (usage) => (metodo === 'complete'
    ? new Response(JSON.stringify({ provider: 'Anthropic', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage }), { status: 200 })
    : new Response(sse([{ provider: 'Anthropic', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, { choices: [], usage }, '[DONE]']), { status: 200 }));
  const chiama = (usage) => withFetch(async () => risposta(usage), () => OR[metodo]({ apiKey: 'k', model: CLAUDE, messages: [{ role: 'user', content: 'ciao' }] }));

  test(`${metodo}: con la chiave dell'owner il costo è commissione più fornitore, e la riga d'uso lo porta`, async () => {
    const r = await chiama(BYOK);
    assert.ok(vicino(r.usage.costUsd, 0.002), String(r.usage.costUsd));
    const conCommissione = await chiama({ ...BYOK, cost: 0.0001 });
    assert.ok(vicino(conCommissione.usage.costUsd, 0.0021), String(conCommissione.usage.costUsd));
    const riga = W.usageRow({ pseudonym: 'p', action: 'filo-chat', model: CLAUDE, usage: conCommissione.usage, costUsd: conCommissione.usage.costUsd });
    assert.ok(vicino(riga.costUsd, 0.0021));
    assert.ok(W.creditsForUsd(riga.costUsd, { eurPerCredit: 0.0007, eurUsd: 1.2 }) > 2, 'la chiamata scala crediti veri');
  });

  test(`${metodo}: senza il totale del fornitore valgono le sue due parti; senza il segno BYOK resta il costo del router`, async () => {
    const parti = await chiama({ ...BYOK, cost_details: { upstream_inference_cost: null, upstream_inference_prompt_cost: 0.001, upstream_inference_completions_cost: 0.0005 } });
    assert.ok(vicino(parti.usage.costUsd, 0.0015), String(parti.usage.costUsd));
    const normale = await chiama({ prompt_tokens: 10, completion_tokens: 5, cost: 0.004, is_byok: false, cost_details: { upstream_inference_cost: 0.004 } });
    assert.ok(vicino(normale.usage.costUsd, 0.004), 'una chiamata pagata dal router non si conta due volte');
    const muto = await chiama({ prompt_tokens: 10, completion_tokens: 5, cost: 0.004, cost_details: { upstream_inference_cost: 0.004 } });
    assert.ok(vicino(muto.usage.costUsd, 0.004));
    const vuoto = await chiama({ prompt_tokens: 10, completion_tokens: 5 });
    assert.equal(vuoto.usage.costUsd, 0);
  });
}

test('le altre strade del router (classificatori, a posteriori) contano il BYOK allo stesso modo', async () => {
  const host = { provider_name: 'TypeSafe', tag: 'typesafe' };
  const dec = await withFetch(async (url) => {
    const u = String(url);
    if (u === OR.ZDR_ENDPOINT) return new Response(JSON.stringify({ data: [{ model_id: 'typesafe/jev-1.13', ...host }] }), { status: 200 });
    if (u.includes('/endpoints')) return new Response(JSON.stringify({ data: { endpoints: [host] } }), { status: 200 });
    return new Response(JSON.stringify({ answers: {}, usage: { input_tokens: 5, output_tokens: 1, ...BYOK } }), { status: 200 });
  }, () => OR.decisions({ apiKey: 'k', model: 'typesafe/jev-1.13', state: 's', questions: {} })).finally(() => OR.forgetModelHosts());
  assert.ok(vicino(dec.usage.costUsd, 0.002), String(dec.usage.costUsd));
  const dopo = await withFetch(async () => new Response(JSON.stringify({ data: { provider_name: 'Anthropic', total_cost: 0.0001, is_byok: true, upstream_inference_cost: 0.003 } }), { status: 200 }),
    () => OR.lookupServedBy({ apiKey: 'k', generationId: 'gen-1' }));
  assert.deepEqual(dopo, { servedBy: 'Anthropic', costUsd: 0.0031 });
  const senza = await withFetch(async () => new Response(JSON.stringify({ data: { provider_name: 'Together', total_cost: 0.000112 } }), { status: 200 }),
    () => OR.lookupServedBy({ apiKey: 'k', generationId: 'gen-2' }));
  assert.deepEqual(senza, { servedBy: 'Together', costUsd: 0.000112 });
});
