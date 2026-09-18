// Ripiego dalla chiave propria ai crediti di Filo (#629): la classificazione
// degli errori che fanno ripiegare e i testi, in src/shared/wallet.js e
// src/shared/chatErrors.js (logica pura, senza Electron); e il punto unico del
// ripiego nel provider, src/main/services/providers/openrouter.js
// `fetchWithKey`, provato con un `fetch` finto e un finto tenutario delle
// chiavi (SN_WALLET_MAIN).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/wallet.js');
require('../../src/shared/chatErrors.js');
require('../../src/main/services/providers/openrouter.js');
const W = globalThis.SN_WALLET;
const CE = globalThis.SN_CHAT_ERRORS;
const P = globalThis.SN_PROVIDER_OPENROUTER;

test('ripiegano solo i rifiuti della CHIAVE: 401, 402, 403; non rete, 429, 5xx, errori di modello', () => {
  for (const st of [401, 402, 403]) assert.equal(W.isKeyRefusalStatus(st), true, `status ${st}`);
  for (const st of [0, 200, 400, 404, 408, 429, 500, 502, 503, undefined, null, 'x']) assert.equal(W.isKeyRefusalStatus(st), false, `status ${st}`);
  assert.equal(W.keyRefusalOf(Object.assign(new Error('OpenRouter 401: {"error":{"message":"User not found."}}'), { status: 401, provider: 'openrouter' })), 401);
  assert.equal(W.keyRefusalOf(new Error('OpenRouter 403: moderation')), 403, 'anche senza status strutturato');
  assert.equal(W.keyRefusalOf(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })), 0, 'rete');
  assert.equal(W.keyRefusalOf(Object.assign(new Error('OpenRouter 429: slow down'), { status: 429 })), 0);
  assert.equal(W.keyRefusalOf(Object.assign(new Error('OpenRouter 500: boom'), { status: 500 })), 0);
  assert.equal(W.keyRefusalOf(null), 0);
});

test('i testi del ripiego: riga in chat, nota in Crediti, coda della chiave, spesa e residuo', () => {
  assert.match(W.ownKeyFallbackLine(401), /OpenRouter ha rifiutato la tua chiave.*crediti di Filo/i);
  assert.match(W.ownKeyFallbackLine(402), /credito è finito/i);
  const note = W.ownKeyRefusalNote({ at: '2026-09-18T07:41:00.000Z', status: 401 });
  assert.match(note, /ha rifiutato/i);
  assert.match(note, /prova prima lei/i);
  assert.match(note, /18 set/i, `manca la data: ${note}`);
  assert.equal(W.keyTail('sk-or-v1-abcdef123456'), '123456');
  assert.equal(W.keyTail(''), '');
  assert.equal(W.ownKeyBalanceLine({ limit: null, usage: 1.234, limit_remaining: null }), 'Spesi 1,23 $ · nessun tetto');
  assert.equal(W.ownKeyBalanceLine({ limit: 10, usage: 1.5, limit_remaining: 8.5 }), 'Spesi 1,50 $ · restano 8,50 $ su 10,00 $');
  assert.equal(W.ownKeyBalanceLine({ limit: 10, usage: 12 }), 'Spesi 12,00 $ · restano 0,00 $ su 10,00 $', 'senza limit_remaining si calcola, mai negativo');
});

// Primo giro di verifica del ramo: una chiave senza tetto (il caso normale)
// deve dire lo stesso quanto resta — il credito dell'account — e chi resta
// senza niente con cui ripiegare deve leggere cos'è successo davvero.
test('chiave senza tetto: resta il credito dell’account; senza risposta, la sola spesa', () => {
  assert.equal(W.ownKeyBalanceLine({ limit: null, usage: 1.5, account: { credits: 25, usage: 5.5 } }), 'Spesi 1,50 $ · restano 19,50 $ sul tuo conto OpenRouter');
  assert.equal(W.ownKeyBalanceLine({ limit: null, usage: 1.5, account: { credits: 3, usage: 9 } }), 'Spesi 1,50 $ · restano 0,00 $ sul tuo conto OpenRouter', 'mai negativo');
  assert.equal(W.ownKeyBalanceLine({ limit: null, usage: 1.5, account: null }), 'Spesi 1,50 $ · nessun tetto');
  assert.equal(W.ownKeyBalanceLine({ limit: 10, usage: 1.5, limit_remaining: 8.5, account: { credits: 25, usage: 5.5 } }), 'Spesi 1,50 $ · restano 8,50 $ su 10,00 $', 'col tetto conta il tetto');
});

test('crediti finiti: la frase dice quale chiave e cosa resta da fare, in chat e nel toast', () => {
  // Propria rifiutata E personale a secco: tutte e due, e domani ne arrivano.
  const both = W.outOfCreditsMessage({ usingOwnKey: true, fallbackFailed: true, hasWallet: true, dailyCredits: 100 });
  assert.match(both, /rifiutato la tua chiave/);
  assert.match(both, /anche i crediti di Filo sono finiti/);
  assert.match(both, /domani ne arrivano 100/);
  assert.ok(!/mettere una tua chiave/.test(both), both);
  // Propria rifiutata senza portafoglio: niente crediti di domani, la strada è un invito.
  const noWallet = W.outOfCreditsMessage({ usingOwnKey: true, hasWallet: false });
  assert.match(noWallet, /tua chiave OpenRouter non ha più credito/);
  assert.match(noWallet, /riscatta un invito/);
  assert.ok(!/domani/.test(noWallet), noWallet);
  assert.ok(!/togli la chiave/.test(noWallet), noWallet);
  // Personale a secco (nessuna chiave propria): i crediti di Filo.
  assert.match(W.outOfCreditsMessage({ usingOwnKey: false, hasWallet: true, dailyCredits: 100 }), /crediti di Filo sono finiti \(domani ne arrivano 100\)/);

  // In chat: la frase scritta da chi tiene le chiavi vince; senza, si legge dall'errore.
  const e402 = (extra) => Object.assign(new Error('OpenRouter 402: Key limit exceeded'), { status: 402, provider: 'openrouter', ...extra });
  assert.equal(CE.friendly(e402({ userMessage: 'frase del main' })), 'frase del main');
  assert.match(CE.friendly(e402({ keySource: 'own', keyFallback: { status: 402, from: 'own', to: 'personal', failed: 402 } })), /anche i crediti di Filo sono finiti/);
  assert.match(CE.friendly(e402({ keySource: 'own' })), /riscatta un invito/);
  assert.match(CE.friendly(e402({ keySource: 'personal' })), /crediti di Filo sono finiti/);
  assert.match(CE.friendly(e402({})), /Se usi già una chiave tua/, 'senza informazioni resta la frase prudente');
});

test('chiave rifiutata in chat: la frase rimanda alla pagina Crediti, non alle Impostazioni', () => {
  for (const st of [401, 403, 402]) {
    const e = Object.assign(new Error(`OpenRouter ${st}: no`), { status: st, provider: 'openrouter' });
    const out = CE.friendly(e);
    assert.match(out, /Crediti/, `status ${st}: ${out}`);
    assert.ok(!/Impostazioni/.test(out), `status ${st} rimanda ancora alle Impostazioni: ${out}`);
  }
  assert.match(W.outOfCreditsMessage({ usingOwnKey: true }), /pagina Crediti/);
  assert.match(W.outOfCreditsMessage({ usingOwnKey: false, dailyCredits: 100 }), /pagina Crediti/);
});

// ── Il punto unico nel provider ──────────────────────────────────────────────

let calls = [];
let statusFor = {};      // chiave → status HTTP della risposta finta
let refusals = [];
const OWN = 'sk-or-v1-own';
const PERSONAL = 'sk-or-v1-personal';

function jsonFetch() {
  return async (url, init) => {
    const key = String(init.headers.Authorization || '').replace('Bearer ', '');
    calls.push({ url, key });
    const status = statusFor[key] ?? 200;
    const body = status === 200
      ? JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.001 }, provider: 'Fake' })
      : JSON.stringify({ error: { message: 'no' } });
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  };
}

beforeEach(() => {
  calls = [];
  refusals = [];
  statusFor = {};
  globalThis.SN_WALLET_MAIN = {
    alternativeKeyFor: async (k) => (k === OWN ? { key: PERSONAL, source: 'personal' } : null),
    keySourceOf: async (k) => (k === OWN ? 'own' : k === PERSONAL ? 'personal' : ''),
    noteOwnKeyRefusal: async (r) => { refusals.push(r); },
  };
  globalThis.fetch = jsonFetch();
});

test('401/402/403 con la chiave propria: si rifà con la personale, nella stessa risposta', async () => {
  for (const st of [401, 402, 403]) {
    calls = []; refusals = [];
    statusFor = { [OWN]: st };
    const r = await P.complete({ apiKey: OWN, model: 'm', messages: [] });
    assert.equal(r.text, 'ok');
    assert.deepEqual(calls.map((c) => c.key), [OWN, PERSONAL], `status ${st}`);
    assert.equal(r.keyUsed, PERSONAL);
    assert.equal(r.usage.keySource, 'personal', 'la riga d’uso si scrive: ha pagato la personale');
    assert.equal(r.keyFallback.status, st);
    assert.equal(r.usage.keyFallback.status, st);
    assert.equal(refusals.length, 1, 'il rifiuto resta registrato');
    assert.equal(refusals[0].status, st);
  }
});

test('rete, 429, 5xx, 400: nessun ripiego, l’errore risale com’è', async () => {
  for (const st of [400, 404, 429, 500, 503]) {
    calls = []; refusals = [];
    statusFor = { [OWN]: st };
    await assert.rejects(P.complete({ apiKey: OWN, model: 'm', messages: [] }), (e) => e.status === st && e.provider === 'openrouter');
    assert.deepEqual(calls.map((c) => c.key), [OWN], `status ${st}: non si prova la personale`);
    assert.equal(refusals.length, 0);
  }
  // Rete: nessuna risposta HTTP, nessun secondo tentativo qui (il ritentativo
  // di rete sta nel router, providers/index.js).
  globalThis.fetch = async (url, init) => { calls.push({ url, key: String(init.headers.Authorization || '').replace('Bearer ', '') }); throw new TypeError('fetch failed'); };
  calls = [];
  await assert.rejects(P.complete({ apiKey: OWN, model: 'm', messages: [] }), /fetch failed/);
  assert.deepEqual(calls.map((c) => c.key), [OWN]);
  assert.equal(refusals.length, 0);
});

test('con la chiave personale già in uso un 402 sono i crediti finiti: nessun ripiego', async () => {
  statusFor = { [PERSONAL]: 402 };
  await assert.rejects(P.complete({ apiKey: PERSONAL, model: 'm', messages: [] }), (e) => e.status === 402);
  assert.deepEqual(calls.map((c) => c.key), [PERSONAL]);
  assert.equal(refusals.length, 0);
});

test('chiave propria valida: una chiamata sola, nessuna riga d’uso, nessun rifiuto', async () => {
  const r = await P.complete({ apiKey: OWN, model: 'm', messages: [] });
  assert.deepEqual(calls.map((c) => c.key), [OWN]);
  assert.equal(r.keyUsed, OWN);
  assert.equal(r.usage.keySource, 'own');
  assert.equal(r.keyFallback, null);
  assert.equal(refusals.length, 0);
});

test('se anche la personale rifiuta, risale l’errore della personale e il rifiuto della propria resta registrato', async () => {
  statusFor = { [OWN]: 401, [PERSONAL]: 402 };
  await assert.rejects(P.complete({ apiKey: OWN, model: 'm', messages: [] }), (e) => e.status === 402);
  assert.deepEqual(calls.map((c) => c.key), [OWN, PERSONAL]);
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].status, 401);
});

test('senza tenutario delle chiavi (contesti senza portafoglio) il provider si comporta come prima', async () => {
  delete globalThis.SN_WALLET_MAIN;
  statusFor = { [OWN]: 401 };
  await assert.rejects(P.complete({ apiKey: OWN, model: 'm', messages: [] }), (e) => e.status === 401);
  assert.deepEqual(calls.map((c) => c.key), [OWN]);
});

test('vale anche per lo streaming, la voce, la dettatura e i vettori: stesso punto, stesso ripiego', async () => {
  statusFor = { [OWN]: 401 };
  globalThis.fetch = async (url, init) => {
    const key = String(init.headers.Authorization || '').replace('Bearer ', '');
    calls.push({ url, key });
    const status = statusFor[key] ?? 200;
    if (status !== 200) return new Response('{"error":{}}', { status });
    if (url === P.SPEECH_ENDPOINT) return new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/pcm;rate=24000', 'x-generation-id': 'g1' } });
    if (url === P.TRANSCRIPTIONS_ENDPOINT) return new Response(JSON.stringify({ text: 'ciao', usage: { cost: 0.001 } }), { status: 200 });
    if (url === P.EMBEDDINGS_ENDPOINT) return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }], usage: { prompt_tokens: 2, cost: 0.0001 } }), { status: 200 });
    // streaming
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"cost":0.001}}\n\ndata: [DONE]\n\n';
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const deltas = [];
  const st = await P.streamComplete({ apiKey: OWN, model: 'm', messages: [], onDelta: (d) => deltas.push(d) });
  assert.equal(st.text, 'ok'); assert.deepEqual(deltas, ['ok']);
  assert.equal(st.keyUsed, PERSONAL); assert.equal(st.usage.keySource, 'personal'); assert.equal(st.keyFallback.status, 401);
  const s = await P.synthesizeSpeech({ apiKey: OWN, model: 'm', text: 'ciao' });
  assert.equal(s.keyUsed, PERSONAL); assert.equal(s.keySource, 'personal'); assert.equal(s.keyFallback.status, 401);
  const t = await P.transcribe({ apiKey: OWN, model: 'm', audioBase64: 'AA==' });
  assert.equal(t.keyUsed, PERSONAL); assert.equal(t.usage.keySource, 'personal');
  const e = await P.embed({ apiKey: OWN, model: 'm', texts: ['a'] });
  assert.equal(e.keyUsed, PERSONAL); assert.equal(e.usage.keySource, 'personal');
  assert.deepEqual(calls.map((c) => c.key), [OWN, PERSONAL, OWN, PERSONAL, OWN, PERSONAL, OWN, PERSONAL]);
});
