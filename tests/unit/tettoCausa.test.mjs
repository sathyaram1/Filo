// #1097.3 — il tetto della risposta, detto quando è lui la causa e taciuto quando non lo è; i tagli senza niente da
// mostrare; gli involucri JSON tagliati a metà. Rete finta per il router e per gli host dichiarati.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/chatErrors.js');
require('../../src/shared/scryfallQuery.js');
require('../../src/shared/lunghezzaRisposte.js');
require('../../src/shared/filoContesto.js');
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

// #1302 — col tetto di serie oltre metà della memoria, i rifiuti per conversazione lunga restano curabili dalla home: la
// regola è quella di stringiDopoRifiuto (handlers.js), che accorcia se non è il tetto o se è `stringibile`.
const laHomeAccorcia = (e) => !!(e && (e.code !== 'TETTO_RISPOSTA' || e.stringibile) && globalThis.SN_FILO_CONTESTO.troppoLungo(e));
const rifiutoOR = (finestra, testo, out) => `This endpoint's maximum context length is ${finestra} tokens. However, you requested about ${testo + out} tokens (${testo} of text input, ${out} in the output).`;

test('conversazione più lunga della memoria col tetto di serie: rifiuto di contesto, la home accorcia e la frase non dice di abbassare il tetto', async () => {
  const e = await OR.httpError(risposta(400, rifiutoOR(65536, 100000, 65536)), { tools: false, maxTokens: 65536 });
  assert.notEqual(e.code, 'TETTO_RISPOSTA');
  assert.equal(e.tettoRetto, undefined);
  assert.ok(laHomeAccorcia(e));
  assert.doesNotMatch(fraseDi(e), /abbassa/i);
});

test('il testo ci sta da solo ma sotto non resta posto per una risposta: niente tetto da riprovare, la home accorcia', async () => {
  const { esito, corpi } = await conRouter({ rifiuta: (b) => (b.max_tokens && 127500 + b.max_tokens > 128000 ? [400, rifiutoOR(128000, 127500, b.max_tokens)] : null) },
    () => chiedi().catch((e) => e));
  assert.equal(corpi.length, 1, 'un tetto sotto il minimo non si prova');
  assert.equal(esito.code, 'TETTO_RISPOSTA');
  assert.ok(laHomeAccorcia(esito));
  // Con posto per una risposta il tetto resta la cura: si rifà più basso e la home non accorcia.
  const t = await OR.httpError(risposta(400, rifiutoOR(128000, 100000, 65536)), { tools: false, maxTokens: 65536 });
  assert.equal(t.code, 'TETTO_RISPOSTA');
  assert.ok(t.tettoRetto > 0);
  assert.ok(!laHomeAccorcia(t));
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
  const r = Q.parseAgentReply('{"reply":"Per questo mazzo servono più pescate:\\n1. Rhystic', 'length');
  assert.equal(r.reply, 'Per questo mazzo servono più pescate:\n1. Rhystic');
});

// #1302: il recupero vale solo per una risposta che il tetto ha fermato e che comincia dall'involucro.
test('una risposta intera scritta male, o della prosa con un esempio fra graffe, si mostra intera', () => {
  const citazioni = '{"reply":"Ti consiglio "Sol Ring" e "Arcane Signet" per la rampa"}';
  assert.equal(Q.parseAgentReply(citazioni, 'stop').reply, citazioni);
  assert.equal(CE.testoDaInvolucro('{"text":"Clicca su "Salva" in alto"}', ['text'], 'stop'), null);
  const prosa = 'Per cercare scrivi così: {"text": "esempio", "x": …} e poi premi Invio.';
  assert.equal(CE.testoDaInvolucro(prosa, ['text'], 'length'), null);
  assert.equal(Q.parseAgentReply('Puoi scrivere {"reply": "una prova" ... come esempio.', 'stop').reply, 'Puoi scrivere {"reply": "una prova" ... come esempio.');
});

test('fermata prima che il campo del testo cominci: niente involucro grezzo da mostrare', () => {
  assert.equal(CE.testoDaInvolucro('{"action":"shell","command":"ls -', ['text'], 'length'), '');
  assert.equal(Q.parseAgentReply('{"query":"o:haste t:creature', 'length').reply, '');
  assert.equal(CE.testoDaInvolucro('```json\n{"text":"Prima parte', ['text'], 'length'), 'Prima parte');
});

test('una risposta interrotta dentro un blocco di codice lo chiude prima della frase', () => {
  assert.equal(CE.chiudiRecinto('Ecco:\n\n```js\nconst a = 1;\n'), 'Ecco:\n\n```js\nconst a = 1;\n```');
  assert.equal(CE.chiudiRecinto('a\n```\nb\n```\nc'), 'a\n```\nb\n```\nc');
});

// #1302 — un rifiuto legato al tetto si racconta per la sua causa, e quando un tetto più basso si regge la richiesta si
// rifà con quello invece di fallire.
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
