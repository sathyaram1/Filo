// #1345: quando il router (o un host) rifiuta perché il modello non legge il contenuto della richiesta (immagini,
// audio, PDF), chi lo racconta dice questo, non «nessun fornitore ammesso». La porta della chat e del «Prova»:
// tests/chat-rifiuto-ingresso.spec.mjs. Gli altri rifiuti del router: openrouterTools.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/chatErrors.js');
require('../../src/main/services/providers/openrouter.js');
const CE = globalThis.SN_CHAT_ERRORS;
const OR = globalThis.SN_PROVIDER_OPENROUTER;

test('il tipo di contenuto si legge dal rifiuto del router e da quello di un host', () => {
  for (const [testo, atteso] of [
    ['No endpoints found that support image input', 'immagini'],
    ['OpenRouter 404: {"error":{"message":"No endpoints found that support image input","code":404}}', 'immagini'],
    ['No endpoints found that support input audio', 'audio'],
    ['No endpoints found that support audio input.', 'audio'],
    ['No endpoints found that support file input', 'pdf'],
    ['No endpoints found that support PDF input', 'pdf'],
    ['No endpoints found that support video input', 'video'],
    ['This model does not support image input', 'immagini'],
    ["Model doesn't support images.", 'immagini'],
    ['Invalid content type. image_url is only supported by certain models.', 'immagini'],
    ['audio input is not supported by this model', 'audio'],
    ['input_audio is not supported', 'audio'],
    ['The model cannot process PDF files', 'pdf'],
  ]) assert.equal(CE.ingressoRifiutato(testo), atteso, testo);
  for (const testo of [
    'No endpoints found that support tool use.',
    'No endpoints found that can handle the requested parameters.',
    'No allowed providers are available for the selected model.',
    'No endpoints found for mistralai/mistral-small.',
    'No endpoints found matching your data policy (Zero data retention).',
    'At most 1 image(s) may be provided in one request.',
    'Image is too large: maximum 5 MB.',
    'Request payload too large',
    // Una foto che un modello che legge le immagini non riesce ad aprire: cambiare modello non è il rimedio.
    'Unable to process input image. Please retry or report in https://developers.generativeai.google/guide/troubleshooting',
    'Provider returned error: Unable to read image',
    '',
  ]) assert.equal(CE.ingressoRifiutato(testo), '', testo);
});

test('la frase dice cosa il modello non legge e dove sceglierne un altro, con il tasto per le Opzioni', () => {
  const err = (testo, extra = {}) => Object.assign(new Error(`OpenRouter 404: ${testo}`), { status: 404, provider: 'openrouter', ...extra });
  const foto = CE.sentence(err('No endpoints found that support image input', { code: 'INGRESSO_NON_LETTO', ingresso: 'immagini' }));
  assert.match(foto, /^Il modello scelto non legge le immagini/);
  assert.match(foto, /Opzioni → Modelli per azione/);
  assert.doesNotMatch(foto, /fornitor|ammess|riprova tra/i);
  assert.match(CE.sentence(err('No endpoints found that support input audio', { code: 'INGRESSO_NON_LETTO' })), /non ascolta l'audio/);
  assert.match(CE.sentence(err('x', { code: 'INGRESSO_NON_LETTO', ingresso: 'pdf' })), /non legge i PDF/);
  assert.match(CE.sentence(err('x', { code: 'INGRESSO_NON_LETTO' })), /non legge un tipo di contenuto/);
  // Senza codice (un errore ricomposto, o un host che risponde 400) la causa si legge dal testo.
  assert.match(CE.sentence(err('No endpoints found that support image input')), /non legge le immagini/);
  assert.match(CE.sentence(Object.assign(new Error('OpenRouter 400: {"error":{"message":"This model does not support image input"}}'), { status: 400, provider: 'openrouter' })), /non legge le immagini/);
  assert.doesNotMatch(CE.sentence(err('No endpoints found that support tool use')), /immagini/);
  const illeggibile = Object.assign(new Error('OpenRouter 400: {"error":{"message":"Provider returned error","metadata":{"raw":"Unable to process input image. Please retry or report"}}}'), { status: 400, provider: 'openrouter' });
  assert.doesNotMatch(CE.sentence(illeggibile), /non legge le immagini|scegline uno che le legga/);
  assert.deepEqual(CE.rimedioPagina({ code: 'INGRESSO_NON_LETTO' }).url, 'filo://options/options.html');
  // Dalla risposta dell'IPC (codice e messaggio grezzo) la frase è la stessa.
  const ipc = CE.sentence(CE.fromResponse({ error: 'OpenRouter 404: {"error":{"message":"No endpoints found that support image input","code":404}}', code: 'INGRESSO_NON_LETTO', status: 404, provider: 'openrouter' }));
  assert.equal(ipc, foto);
});

function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = orig; });
}
const rifiuto = (status, msg) => new Response(JSON.stringify({ error: { code: status, message: msg } }), { status, headers: { 'content-type': 'application/json' } });
const HOSTS = { data: { endpoints: [{ provider_name: 'DeepInfra', tag: 'deepinfra', supported_parameters: ['tools'] }] } };

for (const metodo of ['complete', 'streamComplete']) {
  const foto = [{ role: 'user', content: [{ type: 'text', text: 'cosa c’è?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }];
  const chiama = (extra = {}) => OR[metodo]({ apiKey: 'k', model: 'deepseek/deepseek-v4-flash', messages: foto, providerRouting: { ignore: ['DeepSeek'] }, ...extra });
  const conRouter = (status, msg, conti = { n: 0 }) => (url) => {
    if (/\/endpoints$/.test(String(url))) return new Response(JSON.stringify(HOSTS), { status: 200 });
    conti.n++;
    return rifiuto(status, msg);
  };

  test(`${metodo}: il 404 «nessun host che legga le immagini» non è più «fornitori non ammessi», e non si ritenta`, async () => {
    const conti = { n: 0 };
    const e = await withFetch(conRouter(404, 'No endpoints found that support image input', conti), () => chiama().then(() => null, (x) => x));
    assert.equal(e.code, 'INGRESSO_NON_LETTO');
    assert.equal(e.ingresso, 'immagini');
    assert.equal(conti.n, 1);
    assert.match(CE.sentence(e), /non legge le immagini/);
  });

  test(`${metodo}: con gli strumenti e il ragionamento lo stesso rifiuto non si legge come strumenti`, async () => {
    const conti = { n: 0 };
    const tools = [{ type: 'function', function: { name: 'CERCA_WEB', parameters: { type: 'object', properties: {} } } }];
    const e = await withFetch(conRouter(404, 'No endpoints found that support image input', conti), () => chiama({ tools, reasoning: 'medium' }).then(() => null, (x) => x));
    assert.equal(e.code, 'INGRESSO_NON_LETTO');
    assert.equal(conti.n, 1, 'togliere il ragionamento non fa leggere le immagini');
    assert.doesNotMatch(CE.sentence(e), /strumenti/);
  });

  test(`${metodo}: un host che risponde di non leggere l'audio porta lo stesso codice`, async () => {
    const e = await withFetch(conRouter(400, 'audio input is not supported by this model'), () => chiama().then(() => null, (x) => x));
    assert.equal(e.code, 'INGRESSO_NON_LETTO');
    assert.equal(e.ingresso, 'audio');
  });

  test(`${metodo}: «troppe immagini» resta un altro rifiuto`, async () => {
    const e = await withFetch(conRouter(400, 'At most 1 image(s) may be provided in one request.'), () => chiama().then(() => null, (x) => x));
    assert.notEqual(e.code, 'INGRESSO_NON_LETTO');
  });
}

test('coi crediti di Filo un rifiuto per le immagini non diventa «nessun host a ritenzione zero»', async () => {
  const zdr = { data: [{ provider_name: 'DeepInfra', model_id: 'deepseek/deepseek-v4-flash' }] };
  const e = await withFetch((url) => {
    const u = String(url);
    if (/\/endpoints$/.test(u)) return new Response(JSON.stringify(HOSTS), { status: 200 });
    if (/zdr/.test(u)) return new Response(JSON.stringify(zdr), { status: 200 });
    return rifiuto(404, 'No endpoints found that support image input');
  }, () => OR.complete({ apiKey: 'sk-or-v1-personale', model: 'deepseek/deepseek-v4-flash', messages: [{ role: 'user', content: 'x' }] }).then(() => null, (x) => x));
  assert.equal(e.code, 'INGRESSO_NON_LETTO');
  assert.notEqual(e.reason, 'zdr');
});
