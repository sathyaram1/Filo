// #1097.3 — un 429 o un 5xx si riprova una volta, dopo l'attesa che chiede il servizio, prima di passare al ripiego.
// Mai un 402 (crediti finiti), mai dopo che il testo ha cominciato ad arrivare, mai un'attesa oltre il tetto.
// E il tetto della risposta (max_tokens) arriva al fornitore, con la frase giusta se nessun host lo regge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/chatErrors.js');
require('../../src/main/services/providers/index.js');
require('../../src/main/services/providers/openrouter.js');
const P = globalThis.SN_PROVIDERS;
const OR = globalThis.SN_PROVIDER_OPENROUTER;
const CE = globalThis.SN_CHAT_ERRORS;

const servizio = (status, retryAfterMs) => Object.assign(new Error(`OpenRouter ${status}: occupato`), { status, provider: 'openrouter', ...(retryAfterMs != null ? { retryAfterMs } : {}) });
const tentativo = (provider, extra = {}) => ({ provider, apiKey: 'k', model: 'm', ...extra });

function finto(nome, impl) {
  const key = `SN_PROVIDER_${nome.toUpperCase()}`;
  const prima = globalThis[key];
  globalThis[key] = impl;
  return () => { globalThis[key] = prima; };
}

test('429 con Retry-After: si aspetta quanto chiede e lo stesso tentativo riesce, senza ripiego', async () => {
  let chiamate = 0;
  let riserva = 0;
  const via = [finto('uno', { complete: async () => { chiamate++; if (chiamate === 1) throw servizio(429, 120); return { text: 'ok', usage: {} }; } }),
    finto('due', { complete: async () => { riserva++; return { text: 'riserva', usage: {} }; } })];
  const t0 = Date.now();
  const r = await P.completeWithFallback({ attempts: [tentativo('uno'), tentativo('due')], messages: [] });
  via.forEach((f) => f());
  assert.equal(r.text, 'ok');
  assert.equal(chiamate, 2);
  assert.equal(riserva, 0);
  assert.ok(Date.now() - t0 >= 100, 'ha aspettato quanto chiesto');
});

test('503 due volte: un solo ritentativo, poi il ripiego', async () => {
  let chiamate = 0;
  const via = [finto('uno', { complete: async () => { chiamate++; throw servizio(503, 10); } }),
    finto('due', { complete: async () => ({ text: 'riserva', usage: {} }) })];
  const r = await P.completeWithFallback({ attempts: [tentativo('uno'), tentativo('due')], messages: [] });
  via.forEach((f) => f());
  assert.equal(r.text, 'riserva');
  assert.equal(chiamate, 2);
});

test('402 e attese oltre il tetto non si ritentano', async () => {
  for (const err of [servizio(402), servizio(429, 60_000)]) {
    let chiamate = 0;
    const via = finto('uno', { complete: async () => { chiamate++; throw err; } });
    await assert.rejects(P.completeWithFallback({ attempts: [tentativo('uno')], messages: [] }));
    via();
    assert.equal(chiamate, 1, `status ${err.status}`);
  }
  assert.equal(P.attesaServizio(servizio(400)), null);
  assert.equal(P.attesaServizio(servizio(502)), 1000);
});

test('in streaming, un 5xx dopo che il testo è uscito non si ritenta (nemmeno sapendo azzerare)', async () => {
  let chiamate = 0;
  const via = finto('uno', {
    streamComplete: async ({ onDelta }) => { chiamate++; onDelta('mezza '); throw servizio(502, 10); },
  });
  await assert.rejects(P.streamCompleteWithFallback({ attempts: [tentativo('uno')], messages: [], onDelta: () => {}, onReset: () => {} }));
  via();
  assert.equal(chiamate, 1);
});

test('fermato durante l\'attesa: non si ritenta', async () => {
  let chiamate = 0;
  const ctrl = new AbortController();
  const via = finto('uno', { complete: async () => { chiamate++; throw servizio(429, 5000); } });
  setTimeout(() => ctrl.abort(), 30);
  const t0 = Date.now();
  await assert.rejects(P.completeWithFallback({ attempts: [tentativo('uno')], messages: [], signal: ctrl.signal }));
  via();
  assert.equal(chiamate, 1);
  assert.ok(Date.now() - t0 < 2000);
});

test('il tetto della risposta arriva nel corpo della richiesta; Retry-After e il rifiuto del tetto si leggono', async () => {
  const corpi = [];
  const prima = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    corpi.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ciao' }, finish_reason: 'length' }], usage: {} }), { status: 200 });
  };
  try {
    const r = await P.completeWithFallback({ attempts: [tentativo('openrouter', { maxTokens: 8192 })], messages: [{ role: 'user', content: 'x' }] });
    assert.equal(corpi[0].max_tokens, 8192);
    assert.equal(r.finishReason, 'length');
    await P.completeWithFallback({ attempts: [tentativo('openrouter')], messages: [] });
    assert.equal('max_tokens' in corpi[1], false, 'senza tetto il campo non c\'è');
  } finally { globalThis.fetch = prima; }

  const ora = Date.parse('2026-10-14T10:00:00Z');
  const h = (o) => ({ headers: new Headers(o) });
  assert.equal(OR.attesaChiesta(h({ 'retry-after': '3' }), ora), 3000);
  assert.equal(OR.attesaChiesta(h({ 'retry-after': 'Wed, 14 Oct 2026 10:00:05 GMT' }), ora), 5000);
  assert.equal(OR.attesaChiesta(h({ 'x-ratelimit-reset': String(ora + 2000) }), ora), 2000);
  assert.equal(OR.attesaChiesta(h({}), ora), null);

  const e = await OR.httpError(new Response('{"error":{"message":"max_tokens exceeds the maximum output tokens of every allowed provider"}}', { status: 400 }), { maxTokens: 262144 });
  assert.equal(e.code, 'TETTO_RISPOSTA');
  assert.match(CE.sentence(e), /262\.144 token.*Preferenze/);
  assert.equal(CE.rimedioPagina({ code: 'TETTO_RISPOSTA' }).url, 'filo://preferences/preferences.html#sec-lunghezza');
  // Le due forme in cui il router rifiuta davvero un tetto (#1097 giro 1): la finestra sforata dal solo tetto, e il
  // «nessun host regge i parametri», dove con gli strumenti il tetto è una delle due cause dette.
  const finestra = '{"error":{"message":"This endpoint\'s maximum context length is 163840 tokens. However, you requested about 300000 tokens (37616 of text input, 262144 in the output).","code":400}}';
  const eFin = await OR.httpError(new Response(finestra, { status: 400 }), { maxTokens: 262144, tools: true });
  assert.equal(eFin.code, 'TETTO_RISPOSTA');
  assert.match(CE.sentence(eFin), /tetto di 262\.144 token/);
  const eStretta = await OR.httpError(new Response(finestra, { status: 400 }), { maxTokens: 16384, tools: true });
  assert.ok(eStretta.code === undefined || eStretta.stringibile, 'col tetto piccolo la chat può ancora stringere la conversazione da sé');
  const nessunHost = '{"error":{"message":"No endpoints found that can handle the requested parameters.","code":404}}';
  const eChat = await OR.httpError(new Response(nessunHost, { status: 404 }), { maxTokens: 16384, tools: true });
  assert.equal(eChat.code, 'NO_TOOL_HOST');
  assert.match(CE.sentence(eChat), /strumenti.*tetto di 16\.384 token.*Preferenze/);
  assert.equal(CE.rimedio({ code: 'NO_TOOL_HOST', maxTokens: 16384 }), 'preferenze');
  const eTesto = await OR.httpError(new Response(nessunHost, { status: 404 }), { maxTokens: 16384 });
  assert.equal(eTesto.code, 'TETTO_RISPOSTA');
  assert.equal(CE.fromResponse({ error: 'x', code: 'NO_TOOL_HOST', maxTokens: 16384 }).maxTokens, 16384);
  const e429 = await OR.httpError(new Response('busy', { status: 429, headers: { 'retry-after': '2' } }));
  assert.equal(e429.retryAfterMs, 2000);
  assert.equal(e429.code, undefined);
});
