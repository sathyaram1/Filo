// Unit test per il reasoning "vero" in streaming dei provider (#priorità1 —
// "voglio che venga mostrato il reasoning"). Verifica che, quando il caller
// chiede il ragionamento (onReasoning), lo stream venga DIVISO correttamente:
// i thought summary del modello finiscono su onReasoning, la risposta vera su
// onDelta e nel testo finale — mai mescolati.
//
// Niente rete: si fa il mock di global.fetch con un body SSE che imita le
// risposte reali di Gemini (parti con thought:true) e OpenRouter
// (delta.reasoning). Il test fallirebbe prima del fix perché allora i pensieri
// finivano dentro la risposta (Gemini) o venivano ignorati del tutto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require(join(__dirname, '..', '..', 'src', 'main', 'services', 'providers', 'gemini.js'));
require(join(__dirname, '..', '..', 'src', 'main', 'services', 'providers', 'openrouter.js'));

const Gemini = globalThis.SN_PROVIDER_GEMINI;
const OpenRouter = globalThis.SN_PROVIDER_OPENROUTER;

// Costruisce un Response con un body SSE leggibile a chunk (come quello reale).
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

function withFetch(fn, run) {
  const orig = global.fetch;
  global.fetch = fn;
  return Promise.resolve(run()).finally(() => { global.fetch = orig; });
}

test('Gemini: i thought summary vanno su onReasoning, la risposta su onDelta', async () => {
  const chunks = [
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: 'Sto valutando le opzioni.' }] } }] }) + '\n\n',
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: ' Scelgo la prima.' }] } }] }) + '\n\n',
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Ciao!' }] } }] }) + '\n\n',
  ];
  const reasoning = [];
  const answer = [];
  const sentBody = {};
  const res = await withFetch(
    (url, opts) => { Object.assign(sentBody, JSON.parse(opts.body)); return Promise.resolve(sseResponse(chunks)); },
    () => Gemini.streamComplete({
      apiKey: 'k', model: 'gemini-3.1-flash-lite', messages: [{ role: 'user', content: 'ciao' }],
      onReasoning: (t) => reasoning.push(t),
      onDelta: (t) => answer.push(t),
    }),
  );
  // Il reasoning è stato chiesto → includeThoughts attivo
  assert.equal(sentBody.generationConfig?.thinkingConfig?.includeThoughts, true);
  // I pensieri sono arrivati su onReasoning, NON nella risposta
  assert.equal(reasoning.join(''), 'Sto valutando le opzioni. Scelgo la prima.');
  // La risposta finale contiene SOLO il testo non-thought
  assert.equal(res.text, 'Ciao!');
  assert.equal(answer.join(''), 'Ciao!');
});

test('Gemini: senza onReasoning lo stream resta come prima (nessun thinkingConfig)', async () => {
  const chunks = ['data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Risposta.' }] } }] }) + '\n\n'];
  const sentBody = {};
  const res = await withFetch(
    (url, opts) => { Object.assign(sentBody, JSON.parse(opts.body)); return Promise.resolve(sseResponse(chunks)); },
    () => Gemini.streamComplete({ apiKey: 'k', model: 'gemini-3.1-flash-lite', messages: [{ role: 'user', content: 'x' }], onDelta: () => {} }),
  );
  assert.equal(sentBody.generationConfig?.thinkingConfig?.includeThoughts, undefined);
  assert.equal(res.text, 'Risposta.');
});

test('OpenRouter: delta.reasoning va su onReasoning, delta.content su onDelta', async () => {
  const chunks = [
    'data: ' + JSON.stringify({ choices: [{ delta: { reasoning: 'Penso che' } }] }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ delta: { reasoning: ' la risposta sia 42.' } }] }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'La risposta è 42.' } }] }) + '\n\n',
    'data: [DONE]\n\n',
  ];
  const reasoning = [];
  const answer = [];
  const sentBody = {};
  const res = await withFetch(
    (url, opts) => { Object.assign(sentBody, JSON.parse(opts.body)); return Promise.resolve(sseResponse(chunks)); },
    () => OpenRouter.streamComplete({
      apiKey: 'k', model: 'x/y', messages: [{ role: 'user', content: 'ciao' }],
      onReasoning: (t) => reasoning.push(t),
      onDelta: (t) => answer.push(t),
    }),
  );
  assert.deepEqual(sentBody.reasoning, { enabled: true });
  assert.equal(reasoning.join(''), 'Penso che la risposta sia 42.');
  assert.equal(res.text, 'La risposta è 42.');
  assert.equal(answer.join(''), 'La risposta è 42.');
});
