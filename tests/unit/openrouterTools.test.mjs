// Unit test per il tool calling nel provider OpenRouter
// (src/main/services/providers/openrouter.js).
//
// Il fornitore manda le chiamate agli strumenti A PEZZI, in streaming: un
// delta porta indice, id e nome, i successivi frammenti degli argomenti. Se la
// ricomposizione sbaglia, il modello «chiama» un'azione con argomenti
// spezzati e Filo la rifiuta. Qui una rete finta serve gli stessi eventi SSE
// del router e si controlla: chiamate ricomposte per intero; avviso appena si
// conosce il nome (la chat dice «Cerco sul web…» prima degli argomenti);
// ragionamento strutturato ricomposto per indice; corpo della richiesta con
// gli strumenti e il vincolo sugli host che li supportano.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/main/services/providers/openrouter.js');
const OR = globalThis.SN_PROVIDER_OPENROUTER;
// Il rifiuto del ragionamento si ricorda fra le chiamate: ogni prova parte senza memoria.
beforeEach(() => OR.forgetReasoningRefusals());

function sse(events) {
  const lines = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`);
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
}

function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = orig; });
}

const chunk = (delta, extra) => ({ choices: [{ delta, ...(extra || {}) }], provider: 'DeepInfra' });

test('streaming: le chiamate spezzate in più delta vengono ricomposte, e il nome arriva subito', async () => {
  let body = null;
  const started = [];
  const events = [
    chunk({ reasoning: 'Penso. ', reasoning_details: [{ index: 0, type: 'reasoning.text', text: 'Pen' }] }),
    chunk({ reasoning_details: [{ index: 0, type: 'reasoning.text', text: 'so.' }] }),
    chunk({ content: 'Cerco ' }),
    chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'CERCA_WEB', arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"que' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: 'ry":"meteo"}' } }] }),
    chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'TIMER', arguments: '{"secondi":60}' } }] }),
    chunk({ content: 'e avvio.' }, { finish_reason: 'tool_calls' }),
    { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    '[DONE]',
  ];
  const r = await withFetch(async (url, opts) => {
    body = JSON.parse(opts.body);
    return new Response(sse(events), { status: 200 });
  }, () => OR.streamComplete({
    apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'ciao' }],
    tools: [{ type: 'function', function: { name: 'CERCA_WEB', parameters: { type: 'object', properties: {} } } }],
    providerRouting: { ignore: ['Google'] },
    onToolCall: (c) => started.push(c),
  }));
  assert.deepEqual(body.tools.map((t) => t.function.name), ['CERCA_WEB']);
  assert.equal(body.provider.require_parameters, true);
  assert.deepEqual(body.provider.ignore, ['Google']);
  assert.ok(!('tool_choice' in body));
  assert.equal(r.text, 'Cerco e avvio.');
  assert.deepEqual(r.toolCalls, [
    { id: 'call_a', name: 'CERCA_WEB', arguments: '{"query":"meteo"}' },
    { id: 'call_b', name: 'TIMER', arguments: '{"secondi":60}' },
  ]);
  // Avviso una volta per chiamata, appena c'è il nome.
  assert.deepEqual(started, [{ id: 'call_a', name: 'CERCA_WEB' }, { id: 'call_b', name: 'TIMER' }]);
  assert.deepEqual(r.reasoningDetails, [{ index: 0, type: 'reasoning.text', text: 'Penso.' }]);
  assert.equal(r.finishReason, 'tool_calls');
  assert.equal(r.servedBy, 'DeepInfra');
  assert.equal(r.usage.promptTokens, 10);
});

test('streaming senza strumenti: niente campo tools nel corpo, risposta come prima', async () => {
  let body = null;
  const r = await withFetch(async (url, opts) => {
    body = JSON.parse(opts.body);
    return new Response(sse([chunk({ content: 'Ciao' }), '[DONE]']), { status: 200 });
  }, () => OR.streamComplete({ apiKey: 'k', model: 'm', messages: [], tools: [] }));
  assert.ok(!('tools' in body));
  assert.ok(!body.provider || !('require_parameters' in body.provider), 'senza strumenti gli host non si restringono');
  assert.equal(r.text, 'Ciao');
  assert.deepEqual(r.toolCalls, []);
  assert.deepEqual(r.reasoningDetails, []);
});

test('non in streaming: le chiamate e il ragionamento del messaggio tornano piatti', async () => {
  let body = null;
  const r = await withFetch(async (url, opts) => {
    body = JSON.parse(opts.body);
    return new Response(JSON.stringify({
      provider: 'Fireworks',
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{ id: 'x1', type: 'function', function: { name: 'SVEGLIA', arguments: '{"time":"07:00"}' } }],
          reasoning_details: [{ type: 'reasoning.summary', summary: 'sveglia' }],
        },
      }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }, () => OR.complete({
    apiKey: 'k', model: 'm', messages: [],
    tools: [{ type: 'function', function: { name: 'SVEGLIA', parameters: { type: 'object', properties: {} } } }],
    toolChoice: 'auto',
  }));
  assert.equal(body.tool_choice, 'auto');
  assert.equal(body.provider.require_parameters, true, 'anche senza politica sui fornitori');
  assert.equal(r.text, '');
  assert.deepEqual(r.toolCalls, [{ id: 'x1', name: 'SVEGLIA', arguments: '{"time":"07:00"}' }]);
  assert.deepEqual(r.reasoningDetails, [{ type: 'reasoning.summary', summary: 'sveglia' }]);
  assert.equal(r.finishReason, 'tool_calls');
  assert.equal(r.servedBy, 'Fireworks');
});

test('accumulatore: delta senza indice si accodano in ordine; un blocco cifrato tiene la firma', () => {
  const acc = OR.createToolCallAccumulator(null);
  acc.push([{ function: { name: 'A', arguments: '{' } }]);
  acc.push([{ index: 0, function: { arguments: '}' } }]);
  assert.deepEqual(acc.list(), [{ id: '', name: 'A', arguments: '{}' }]);
  const det = OR.createReasoningDetailsAccumulator();
  det.push([{ index: 0, type: 'reasoning.encrypted', data: 'AB' }]);
  det.push([{ index: 0, data: 'CD', signature: 'sig' }]);
  det.push([{ index: 1, type: 'reasoning.text', text: 'poi' }]);
  assert.deepEqual(det.list(), [
    { index: 0, type: 'reasoning.encrypted', data: 'ABCD', signature: 'sig' },
    { index: 1, type: 'reasoning.text', text: 'poi' },
  ]);
});

// #700 — host che non reggono gli strumenti: il router li scarta, e se fra gli ammessi non ne resta
// nessuno la richiesta fallisce dicendolo, senza mai ripartire libera da quel vincolo.
require('../../src/shared/chatErrors.js');
const CE = globalThis.SN_CHAT_ERRORS;
const TOOL = [{ type: 'function', function: { name: 'CERCA_WEB', parameters: { type: 'object', properties: {} } } }];
const noHost = (msg) => new Response(JSON.stringify({ error: { code: 404, message: msg } }), { status: 404, headers: { 'content-type': 'application/json' } });
const DATA_POLICY = 'No endpoints found matching your data policy (Paid model training). Configure: https://openrouter.ai/settings/privacy';
const NO_PARAMS = 'No endpoints found that can handle the requested parameters. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing';

for (const metodo of ['streamComplete', 'complete']) {
  const ok = () => (metodo === 'streamComplete'
    ? new Response(sse([chunk({ content: 'Fatto' }), '[DONE]']), { status: 200 })
    : new Response(JSON.stringify({ provider: 'DeepInfra', choices: [{ message: { content: 'Fatto' } }], usage: {} }), { status: 200 }));
  const call = (extra) => OR[metodo]({
    apiKey: 'k', model: 'mistralai/mistral-small', messages: [{ role: 'user', content: 'ciao' }],
    tools: TOOL, reasoning: 'medium', providerRouting: { ignore: ['Mistral'], sort: 'latency' },
    ...(metodo === 'streamComplete' ? { onReasoning: () => {} } : {}), ...(extra || {}),
  });

  test(`${metodo}: un modello che non ragiona non perde la chat — si rifà senza ragionamento, strumenti e vincoli intatti`, async () => {
    const bodies = [];
    const r = await withFetch(async (url, opts) => {
      const b = JSON.parse(opts.body);
      bodies.push(b);
      return b.reasoning ? noHost(NO_PARAMS) : ok();
    }, () => call());
    assert.equal(r.text, 'Fatto');
    assert.equal(bodies.length, 2);
    assert.ok(bodies[0].reasoning, 'la prima chiede il ragionamento');
    assert.ok(!('reasoning' in bodies[1]));
    for (const b of bodies) {
      assert.equal(b.provider.require_parameters, true);
      assert.deepEqual(b.provider.ignore, ['Mistral']);
      assert.equal(b.provider.sort, 'latency');
      assert.equal(b.tools[0].function.name, 'CERCA_WEB');
    }
  });

  test(`${metodo}: il rifiuto del ragionamento si paga una volta, poi si chiede subito senza; scaduto, si riprova`, async () => {
    const bodies = [];
    const fetchRifiuta = async (url, opts) => {
      const b = JSON.parse(opts.body);
      bodies.push(b);
      return b.reasoning ? noHost(NO_PARAMS) : ok();
    };
    await withFetch(fetchRifiuta, async () => {
      assert.equal((await call()).text, 'Fatto');
      assert.equal((await call()).text, 'Fatto');
      assert.equal((await call()).text, 'Fatto');
    });
    assert.deepEqual(bodies.map((b) => 'reasoning' in b), [true, false, false, false]);
    assert.ok(bodies.every((b) => b.provider.require_parameters === true && b.provider.ignore.includes('Mistral')));

    // Altri vincoli sugli host sono un'altra domanda al router: il ricordo non vale.
    bodies.length = 0;
    await withFetch(fetchRifiuta, () => call({ providerRouting: { ignore: ['Mistral'], sort: 'throughput' } }));
    assert.deepEqual(bodies.map((b) => 'reasoning' in b), [true, false]);

    const now = Date.now;
    bodies.length = 0;
    try {
      Date.now = () => now() + 2 * 60 * 60 * 1000;
      await withFetch(fetchRifiuta, () => call());
    } finally { Date.now = now; }
    assert.deepEqual(bodies.map((b) => 'reasoning' in b), [true, false]);
  });

  test(`${metodo}: un rifiuto per gli strumenti non fa dimenticare il ragionamento alle chiamate dopo`, async () => {
    const bodies = [];
    await withFetch(async (url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return noHost(NO_PARAMS);
    }, () => call().catch(() => null));
    bodies.length = 0;
    await withFetch(async (url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return ok();
    }, () => call());
    assert.equal(bodies.length, 1);
    assert.ok(bodies[0].reasoning, 'il ragionamento torna nella richiesta');
  });

  test(`${metodo}: nessun host ammesso regge gli strumenti → errore dichiarato, mai una richiesta senza vincolo`, async () => {
    const bodies = [];
    const err = await withFetch(async (url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return noHost(NO_PARAMS);
    }, () => call().then(() => null, (e) => e));
    assert.ok(err, 'la richiesta deve fallire');
    assert.equal(err.status, 404);
    assert.equal(err.code, 'NO_TOOL_HOST');
    assert.equal(bodies.length, 2);
    assert.ok(bodies.every((b) => b.provider.require_parameters === true && b.provider.ignore.includes('Mistral')));
    assert.match(CE.sentence(err), /^Per il modello scelto nessun fornitore ammesso sa usare gli strumenti/);
  });

  test(`${metodo}: un rifiuto per la privacy dell'account non si legge come strumenti e non si ritenta`, async () => {
    const bodies = [];
    const err = await withFetch(async (url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return noHost(DATA_POLICY);
    }, () => call().then(() => null, (e) => e));
    assert.equal(bodies.length, 1, 'togliere il ragionamento non cambia la politica sui dati');
    assert.equal(err.code, 'DATA_POLICY');
    assert.doesNotMatch(CE.sentence(err), /strumenti/);
    assert.match(CE.sentence({ ...err, message: err.message, keySource: 'own' }), /privacy del tuo account OpenRouter/);
    assert.match(CE.sentence({ ...err, message: err.message, keySource: 'personal' }), /privacy/);
  });

  test(`${metodo}: senza ragionamento in richiesta il rifiuto non si ritenta`, async () => {
    const bodies = [];
    const err = await withFetch(async (url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return noHost('No endpoints found that support tool use.');
    }, () => OR[metodo]({ apiKey: 'k', model: 'm', messages: [], tools: TOOL }).then(() => null, (e) => e));
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].provider.require_parameters, true);
    assert.equal(err.code, 'NO_TOOL_HOST');
  });
}

test('altri rifiuti: un 400 non si ritenta, e un 404 senza strumenti resta un errore qualunque', async () => {
  let n = 0;
  const e400 = await withFetch(async () => {
    n++;
    return new Response('{"error":{"message":"Invalid parameter: tools"}}', { status: 400 });
  }, () => OR.complete({ apiKey: 'k', model: 'm', messages: [], tools: TOOL, reasoning: 'high' }).then(() => null, (e) => e));
  assert.equal(n, 1);
  assert.equal(e400.status, 400);
  assert.notEqual(e400.code, 'NO_TOOL_HOST');

  const bodies = [];
  const e404 = await withFetch(async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return noHost('No allowed providers are available for the selected model.');
  }, () => OR.complete({ apiKey: 'k', model: 'm', messages: [], reasoning: 'high', providerRouting: { ignore: ['Google'] } }).then(() => null, (e) => e));
  assert.equal(bodies.length, 1);
  assert.ok(!('require_parameters' in bodies[0].provider));
  assert.equal(e404.status, 404);
  assert.notEqual(e404.code, 'NO_TOOL_HOST');
});
