// Unit test — gli strumenti di test agentici non passano più da Google (#461).
//
// Gemma ha i pesi aperti, quindi il modello va bene: era il FORNITORE a essere
// escluso dalla politica sui modelli, che vale anche per lo sviluppo di Filo.
// Qui si verifica che l'esplorazione funzioni con la sola chiave OpenRouter
// (nessuna chiave Google configurata), che la lista di esclusione viaggi con
// ogni richiesta e che una risposta servita da un escluso venga rifiutata.
//
// Senza il fix: il client parlava con generativelanguage.googleapis.com e
// pretendeva GEMINI_API_KEY — questi test sarebbero tutti rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ambiente del test: SOLO la chiave OpenRouter. Le chiavi Google non esistono.
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;
process.env.OPENROUTER_API_KEY = 'k-test-openrouter';

const llm = await import('../agent/llm.mjs');

function stubFetch(handler) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return handler(calls[calls.length - 1]);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const okResponse = (text, provider = 'DeepInfra') => ({
  ok: true, status: 200,
  json: async () => ({ provider, choices: [{ message: { content: text } }] }),
  text: async () => '',
});

test('la richiesta va a un fornitore indipendente, non ai server del produttore', async () => {
  const f = stubFetch(() => okResponse('{"hi":true}'));
  try {
    const out = await llm.generate({ model: 'google/gemma-4-31b-it', user: 'ciao' });
    assert.equal(out, '{"hi":true}');
  } finally { f.restore(); }

  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /openrouter\.ai/);
  assert.doesNotMatch(f.calls[0].url, /googleapis\.com/);
  // La chiave viaggia come Bearer del fornitore indipendente, non in query string.
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer k-test-openrouter');
  assert.doesNotMatch(f.calls[0].url, /key=/);
});

test('ogni richiesta porta con sé la lista di esclusione dei produttori', async () => {
  const f = stubFetch(() => okResponse('{}'));
  try {
    await llm.generate({ model: 'google/gemma-4-31b-it', user: 'ciao' });
  } finally { f.restore(); }

  const ignore = f.calls[0].body.provider.ignore.map((s) => s.toLowerCase());
  assert.ok(ignore.includes('google'), 'chi ha prodotto Gemma non deve servirlo');
  assert.ok(ignore.includes('openai'));
  assert.ok(ignore.includes('anthropic'), 'gli strumenti di test usano solo pesi aperti');
});

test('gli screenshot arrivano al modello come immagini, non come testo perso', async () => {
  const f = stubFetch(() => okResponse('{}'));
  try {
    await llm.generate({
      model: 'google/gemma-4-31b-it',
      system: 'sei un tester',
      contents: [{
        role: 'user',
        parts: [
          { text: 'guarda' },
          { inline_data: { mime_type: 'image/png', data: 'QUJD' } },
        ],
      }],
    });
  } finally { f.restore(); }

  const msgs = f.calls[0].body.messages;
  assert.equal(msgs[0].role, 'system');
  const user = msgs[1];
  assert.equal(user.role, 'user');
  const img = user.content.find((c) => c.type === 'image_url');
  assert.ok(img, 'l\'immagine deve arrivare al modello');
  assert.equal(img.image_url.url, 'data:image/png;base64,QUJD');
  assert.ok(user.content.some((c) => c.type === 'text' && c.text === 'guarda'));
});

test('una risposta servita da un fornitore escluso viene rifiutata subito', async () => {
  const f = stubFetch(() => okResponse('{"ok":true}', 'Google AI Studio'));
  try {
    await assert.rejects(
      () => llm.generate({ model: 'google/gemma-4-31b-it', user: 'ciao' }),
      /ESCLUSO/,
    );
  } finally { f.restore(); }
  // Una violazione non è un guasto passeggero: ritentarla la ripeterebbe
  // pagandola di nuovo. Una chiamata sola.
  assert.equal(f.calls.length, 1);
});

test('senza output strutturato il client riprova in JSON libero invece di arrendersi', async () => {
  let n = 0;
  const f = stubFetch(() => {
    n++;
    if (n === 1) {
      return {
        ok: false, status: 400,
        text: async () => 'response_format json_schema non supportato da questo modello',
        json: async () => ({}),
      };
    }
    return okResponse('{"screen":"ok"}');
  });
  try {
    const out = await llm.generate({
      model: 'google/gemma-4-31b-it', user: 'ciao',
      schema: { type: 'object', properties: { screen: { type: 'string' } } },
    });
    assert.equal(out, '{"screen":"ok"}');
  } finally { f.restore(); }

  assert.equal(n, 2);
  assert.equal(f.calls[0].body.response_format.type, 'json_schema');
  assert.equal(f.calls[1].body.response_format, undefined);
  // Anche il tentativo di ripiego resta dentro la politica.
  assert.ok(f.calls[1].body.provider.ignore.length);
});

test('senza chiave OpenRouter lo dice chiaramente (e non cerca una chiave Google)', async () => {
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.throws(() => llm.getApiKey(), /OPENROUTER_API_KEY/);
  } finally { process.env.OPENROUTER_API_KEY = saved; }
});
