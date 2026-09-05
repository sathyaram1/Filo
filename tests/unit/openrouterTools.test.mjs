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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/main/services/providers/openrouter.js');
const OR = globalThis.SN_PROVIDER_OPENROUTER;

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
    providerRouting: { ignore: ['Google'], requireParameters: true },
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
