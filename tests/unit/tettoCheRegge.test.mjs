// #1302 — un rifiuto legato al tetto della risposta si racconta per la sua causa, e quando il tetto si può reggere
// più basso la richiesta si rifà con quello invece di fallire. Rete finta per il router e per gli host dichiarati.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/chatErrors.js');
require('../../src/main/services/providers/index.js');
require('../../src/main/services/providers/openrouter.js');
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const CE = globalThis.SN_CHAT_ERRORS;
beforeEach(() => OR.forgetModelHosts());

const NO_PARAMS = 'No endpoints found that can handle the requested parameters.';
const MODELLO = 'acme/modello-x';
const host = (provider_name, supported, max) => ({ provider_name, tag: provider_name.toLowerCase(), supported_parameters: supported, max_completion_tokens: max });
const risposta = (status, message) => ({ status, ok: false, text: async () => JSON.stringify({ error: { message } }), headers: { get: () => null } });
const fraseDi = (e) => CE.sentence(CE.fromResponse({ error: e.message, code: e.code || 'UNKNOWN', ...CE.dettagliDelTetto(e) }));

// Router finto: `rifiuti` decide, dal corpo mandato, se rifiutare (status, messaggio) o rispondere.
async function conRouter({ endpoints = null, rifiuta }, fn) {
  const orig = globalThis.fetch;
  const corpi = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/endpoints')) {
      return endpoints ? new Response(JSON.stringify({ data: { endpoints } }), { status: 200 }) : new Response('{}', { status: 500 });
    }
    if (/chat\/completions/.test(String(url))) {
      const body = JSON.parse(init.body);
      corpi.push(body);
      const no = rifiuta(body);
      if (no) return new Response(JSON.stringify({ error: { message: no[1] } }), { status: no[0] });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Risposta intera.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } }), { status: 200 });
    }
    throw new Error(`rete finta: ${url}`);
  };
  try { return { esito: await fn(), corpi }; } finally { globalThis.fetch = orig; }
}
const chiedi = (extra = {}) => OR.complete({ apiKey: 'k', model: MODELLO, messages: [{ role: 'user', content: 'ciao' }], maxTokens: 65536, ...extra });

test('un fornitore regge strumenti e un tetto più lungo: la frase non dà la colpa al tetto né agli strumenti', async () => {
  const e = await conRouter({ endpoints: [host('A', ['tools', 'max_tokens'], 131072)], rifiuta: () => [404, NO_PARAMS] },
    () => OR.httpError(risposta(404, NO_PARAMS), { tools: true, maxTokens: 16384, apiKey: 'k', model: MODELLO }));
  assert.equal(e.esito.code, 'PARAMETRI_HOST');
  const s = fraseDi(e.esito);
  assert.doesNotMatch(s, /abbassa/);
  assert.match(s, /il tetto di lunghezza non c'entra/);
  assert.equal(CE.rimedio(e.esito), 'opzioni');
});

test('gli host reggono gli strumenti ma non il tetto: si rifà col massimo che reggono, e la risposta arriva', async () => {
  const endpoints = [host('A', ['tools', 'max_tokens'], 32768), host('B', ['tools', 'max_tokens'], 16384)];
  const { esito, corpi } = await conRouter({ endpoints, rifiuta: (b) => (b.max_tokens > 32768 ? [404, NO_PARAMS] : null) },
    () => chiedi({ tools: [{ type: 'function', function: { name: 'x', parameters: { type: 'object' } } }] }));
  assert.equal(esito.text, 'Risposta intera.');
  assert.deepEqual(corpi.map((b) => b.max_tokens), [65536, 32768]);
  assert.deepEqual(esito.tettoSceso, { chiesto: 65536, usato: 32768 });
});

test('elenco dei fornitori illeggibile: si rifà senza tetto; se il router rifiuta ancora, il tetto non è la causa', async () => {
  const riuscita = await conRouter({ rifiuta: (b) => (b.max_tokens ? [404, NO_PARAMS] : null) }, () => chiedi({ tools: [{ type: 'function', function: { name: 'x', parameters: { type: 'object' } } }] }));
  assert.equal(riuscita.esito.text, 'Risposta intera.');
  assert.equal(riuscita.corpi[1].max_tokens, undefined);
  const { esito } = await conRouter({ rifiuta: () => [404, NO_PARAMS] }, () => chiedi({ tools: [{ type: 'function', function: { name: 'x', parameters: { type: 'object' } } }] }).catch((e) => e));
  assert.equal(esito.code, 'NO_TOOL_HOST');
  assert.equal(esito.maxTokens, undefined);
  assert.doesNotMatch(fraseDi(esito), /tetto/);
});

test('un fornitore che non dichiara la sua lunghezza massima non fa dare la colpa al tetto senza prova', async () => {
  const endpoints = [host('A', ['tools', 'max_tokens'], 8192), { provider_name: 'B', tag: 'b', supported_parameters: ['tools', 'max_tokens'] }];
  const { corpi, esito } = await conRouter({ endpoints, rifiuta: (b) => (b.max_tokens ? [404, NO_PARAMS] : null) }, () => chiedi({ tools: [{ type: 'function', function: { name: 'x', parameters: { type: 'object' } } }] }));
  assert.equal(esito.text, 'Risposta intera.');
  assert.equal(corpi.length, 2);
  assert.equal(corpi[1].max_tokens, undefined);
});

test('«context_length_exceeded» senza numeri: nomina tetto e memoria, non «Riprova», e la chat può accorciare', async () => {
  const e = await OR.httpError(risposta(400, 'context_length_exceeded'), { tools: false, maxTokens: 16384 });
  assert.equal(e.code, 'TETTO_RISPOSTA');
  assert.ok(e.stringibile);
  const s = fraseDi(e);
  assert.match(s, /tetto di 16\.384 token/);
  assert.match(s, /memoria/);
  assert.doesNotMatch(s, /Riprova|nessun fornitore/);
});

test('«190000 + 32000 > 200000»: si rifà col tetto che ci sta e la risposta arriva', async () => {
  const msg = 'input length and max_tokens exceed context limit: 190000 + 32000 > 200000, decrease input length or max_tokens and try again';
  const { esito, corpi } = await conRouter({ rifiuta: (b) => (b.max_tokens > 10000 ? [400, msg] : null) }, () => chiedi({ maxTokens: 32000 }));
  assert.equal(esito.text, 'Risposta intera.');
  assert.equal(corpi[1].max_tokens, 200000 - 190000 - 256);
});

test('testo quasi pari alla memoria: non c\'è un tetto utile, la frase dice testo più tetto e la chat accorcia', async () => {
  const msg = 'input length and max_tokens exceed context limit: 199500 + 32000 > 200000';
  const { esito, corpi } = await conRouter({ rifiuta: () => [400, msg] }, () => chiedi({ maxTokens: 32000 }).catch((e) => e));
  assert.equal(corpi.length, 1, 'un tetto sotto il minimo non si prova');
  assert.equal(esito.code, 'TETTO_RISPOSTA');
  assert.ok(esito.stringibile);
  assert.match(fraseDi(esito), /supera la memoria del modello scelto \(200\.000 token\)/);
  assert.doesNotMatch(fraseDi(esito), /nessun fornitore/);
});

test('«tools are not supported with max_tokens > 8192»: si rifà a 8192; se non basta la frase nomina strumenti e tetto', async () => {
  const msg = 'tools are not supported with max_tokens > 8192';
  const tools = [{ type: 'function', function: { name: 'x', parameters: { type: 'object' } } }];
  const ok = await conRouter({ rifiuta: (b) => (b.max_tokens > 8192 ? [400, msg] : null) }, () => chiedi({ tools }));
  assert.equal(ok.esito.text, 'Risposta intera.');
  assert.equal(ok.corpi[1].max_tokens, 8192);
  const { esito } = await conRouter({ rifiuta: () => [400, msg] }, () => chiedi({ tools }).catch((e) => e));
  assert.equal(esito.code, 'NO_TOOL_HOST');
  const s = fraseDi(esito);
  assert.match(s, /strumenti/);
  assert.match(s, /tetto di 65\.536 token/);
});
