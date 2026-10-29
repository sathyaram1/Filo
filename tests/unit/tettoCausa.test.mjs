// #1097.3 — il tetto della risposta, detto quando è lui la causa e taciuto quando non lo è; i tagli senza niente da
// mostrare; gli involucri JSON tagliati a metà. Rete finta per il router e per gli host dichiarati.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/chatErrors.js');
require('../../src/shared/scryfallQuery.js');
require('../../src/main/services/providers/index.js');
require('../../src/main/services/providers/openrouter.js');
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const CE = globalThis.SN_CHAT_ERRORS;
const Q = globalThis.SN_SCRYFALL_Q;
beforeEach(() => OR.forgetModelHosts());

const risposta = (status, message) => ({ status, ok: false, text: async () => JSON.stringify({ error: { message } }), headers: { get: () => null } });
const NO_PARAMS = 'No endpoints found that can handle the requested parameters.';
const MODELLO = 'acme/modello-x';

async function conHost(endpoints, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/endpoints')) return new Response(JSON.stringify({ data: { endpoints } }), { status: 200 });
    throw new Error(`rete finta: ${url}`);
  };
  try { return await fn(); } finally { globalThis.fetch = orig; }
}
const host = (provider_name, supported, max) => ({ provider_name, tag: provider_name.toLowerCase(), supported_parameters: supported, max_completion_tokens: max });

test('nessun host ammesso regge gli strumenti: la frase parla degli strumenti, non del tetto', async () => {
  const e = await conHost([host('Alfa', ['max_tokens'], 65536), host('Beta', ['max_tokens'], 65536)], () => OR.httpError(
    risposta(404, NO_PARAMS), { tools: true, maxTokens: 16384, apiKey: 'k', model: MODELLO }));
  assert.equal(e.code, 'NO_TOOL_HOST');
  assert.equal(e.maxTokens, undefined);
  assert.match(CE.sentence(e), /^Per il modello scelto nessun fornitore ammesso sa usare gli strumenti/);
  // La cura è un altro modello: il tasto porta alle Opzioni.
  assert.equal(CE.rimedio(e), 'opzioni');
});

test('gli host con gli strumenti non arrivano al tetto: la frase nomina il tetto e porta alle Preferenze', async () => {
  const e = await conHost([host('Alfa', ['tools', 'max_tokens'], 8192), host('Beta', ['max_tokens'], 65536)], () => OR.httpError(
    risposta(404, NO_PARAMS), { tools: true, maxTokens: 16384, apiKey: 'k', model: MODELLO }));
  assert.equal(e.code, 'NO_TOOL_HOST');
  assert.equal(e.maxTokens, 16384);
  assert.match(CE.sentence(e), /tetto di 16\.384 token/);
  assert.equal(CE.rimedio(e), 'preferenze');
});

test('un host escluso dalle regole non conta fra quelli che reggono gli strumenti', async () => {
  const e = await conHost([host('Alfa', ['tools', 'max_tokens'], 65536), host('Beta', ['max_tokens'], 65536)], () => OR.httpError(
    risposta(404, NO_PARAMS), { tools: true, maxTokens: 16384, apiKey: 'k', model: MODELLO, providerRouting: { ignore: ['Alfa'] } }));
  assert.equal(e.maxTokens, undefined);
});

test('modello da 32 mila, testo lungo e tetto di partenza: la frase nomina il tetto e la memoria del modello', async () => {
  const msg = "This endpoint's maximum context length is 32768 tokens. However, you requested about 40000 tokens (23616 of text input, 16384 in the output).";
  const e = await OR.httpError(risposta(400, msg), { tools: false, maxTokens: 16384 });
  assert.equal(e.code, 'TETTO_RISPOSTA');
  assert.equal(e.finestra, 32768);
  assert.ok(e.stringibile, 'la chat può ancora accorciare la conversazione');
  const frase = CE.sentence(CE.fromResponse({ error: e.message, code: e.code, maxTokens: e.maxTokens, finestra: e.finestra }));
  assert.match(frase, /tetto di 16\.384 token/);
  assert.match(frase, /32\.768 token/);
  assert.doesNotMatch(frase, /Riprova/);
});

// Anthropic dietro OpenRouter: l'errore dell'host arriva dentro `metadata.raw`.
const rifiutoAnthropic = (message) => ({
  status: 400, ok: false, headers: { get: () => null },
  text: async () => JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { raw: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }), provider_name: 'Anthropic' } } }),
});

test('Anthropic, ingresso più tetto oltre la finestra: la chat può ancora accorciare; un tetto da più di metà finestra resta la causa', async () => {
  const e = await OR.httpError(rifiutoAnthropic('input length and `max_tokens` exceed context limit: 188240 + 16384 > 200000, decrease input length or `max_tokens` and try again'), { tools: true, maxTokens: 16384 });
  assert.equal(e.finestra, 200000);
  assert.ok(e.stringibile, 'il testo da solo ci sta: la chat accorcia pagine e conversazione');
  const t = await OR.httpError(rifiutoAnthropic('input length and `max_tokens` exceed context limit: 50000 + 128000 > 160000, decrease input length or `max_tokens` and try again'), { tools: false, maxTokens: 128000 });
  assert.equal(t.code, 'TETTO_RISPOSTA');
  assert.ok(!t.stringibile);
});

test('un testo che da solo non sta nella memoria resta un rifiuto di contesto, non del tetto', async () => {
  const msg = "This endpoint's maximum context length is 32768 tokens. However, you requested about 56384 tokens (40000 of text input, 16384 in the output).";
  const e = await OR.httpError(risposta(400, msg), { tools: false, maxTokens: 16384 });
  assert.notEqual(e.code, 'TETTO_RISPOSTA');
});

test('le altre forme del rifiuto per il tetto si riconoscono; un parametro non supportato no', async () => {
  const casi = [
    [400, 'Input validation error: `inputs` tokens + `max_new_tokens` must be <= 32768. Given: 1000 `inputs` tokens and 262144 `max_new_tokens`'],
    [400, 'Prompt tokens limit exceeded: 270000 > 163840'],
    [422, 'max_tokens must be less than or equal to 32768'],
  ];
  for (const [st, msg] of casi) {
    const e = await OR.httpError(risposta(st, msg), { tools: false, maxTokens: 262144 });
    assert.equal(e.code, 'TETTO_RISPOSTA', msg);
  }
  const e = await OR.httpError(risposta(400, "Unsupported parameter: 'max_tokens' is not supported with this model."), { tools: false, maxTokens: 16384 });
  assert.notEqual(e.code, 'TETTO_RISPOSTA');
});

test('il tasto per le Preferenze ha il suo suggerimento, non quello della chiave', () => {
  assert.equal(CE.rimedioPagina({ code: 'TETTO_RISPOSTA' }).title, 'Cambia quanto può essere lunga una risposta');
  assert.equal(CE.rimedioPagina({ code: 'NO_TOOL_HOST', maxTokens: 16384 }).dove, 'preferenze');
});

test('un taglio senza niente da mostrare è un errore che nomina il tetto; uno con del testo no', () => {
  const e = CE.erroreDelTaglio({ text: '  ', finishReason: 'length', toolCalls: [] });
  assert.equal(e.code, 'RISPOSTA_TAGLIATA');
  assert.match(e.message, /prima di scrivere la risposta/);
  const ricomposto = CE.fromResponse({ error: e.message, code: e.code, finishReason: 'length', vuota: true });
  assert.match(CE.sentence(ricomposto), /alza il tetto in Preferenze/);
  assert.equal(CE.rimedio(ricomposto), 'preferenze');
  assert.equal(CE.erroreDelTaglio({ text: 'mezza risposta', finishReason: 'length' }), null);
  assert.equal(CE.erroreDelTaglio({ text: '', finishReason: 'length', toolCalls: [{ name: 'CERCA_WEB' }] }), null);
  assert.ok(CE.erroreDelTaglio({ text: 'mezza risposta', finishReason: 'length' }, { intera: true }));
});

test('un involucro JSON tagliato a metà mostra il testo che il modello aveva scritto', () => {
  assert.equal(CE.campoDaJsonTagliato('{"status":"done","text":"Prima riga\\nseconda \\"citata\\" \\u00e8 tagl', ['text']), 'Prima riga\nseconda "citata" è tagl');
  assert.equal(CE.campoDaJsonTagliato('niente involucro', ['text']), null);
  const r = Q.parseAgentReply('{"reply":"Per questo mazzo servono più pescate:\\n1. Rhystic');
  assert.equal(r.reply, 'Per questo mazzo servono più pescate:\n1. Rhystic');
});

test('una risposta interrotta dentro un blocco di codice lo chiude prima della frase', () => {
  assert.equal(CE.chiudiRecinto('Ecco:\n\n```js\nconst a = 1;\n'), 'Ecco:\n\n```js\nconst a = 1;\n```');
  assert.equal(CE.chiudiRecinto('a\n```\nb\n```\nc'), 'a\n```\nb\n```\nc');
});
