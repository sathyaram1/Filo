// #360 — "il fetch failed": un buco di rete di un istante non deve diventare un
// errore in faccia all'utente. Prima di ripiegare su un altro provider, la
// catena ritenta LO STESSO tentativo dopo una pausa breve; solo per i guasti
// passeggeri (nessuna risposta HTTP arrivata), mai per un 400/401.
//
// Senza il ritentativo il primo test è rosso: la chiamata fallisce al primo
// colpo e nessuno riprova.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/chatErrors.js');

// Provider finti registrati PRIMA di caricare il router: getProvider li legge
// da globalThis al momento della chiamata.
function installProvider(name, impl) {
  const key = name === 'fake' ? 'SN_PROVIDER_FAKE' : 'SN_PROVIDER_OPENROUTER';
  globalThis[key] = impl;
}

require('../../src/main/services/providers/index.js');
const P = globalThis.SN_PROVIDERS;

const attempt = (provider) => ({ provider, apiKey: 'k', model: 'm' });

test('guasto di rete passeggero: la stessa chiamata viene ritentata e riesce', async () => {
  let calls = 0;
  installProvider('fake', {
    complete: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return { text: 'ok', usage: {} };
    },
  });
  const r = await P.completeWithFallback({ attempts: [attempt('fake')], messages: [] });
  assert.equal(r.text, 'ok');
  assert.equal(calls, 2, 'il tentativo doveva essere ripetuto una volta');
});

test('rete giù per davvero: dopo il ritentativo si passa al provider successivo', async () => {
  let gem = 0; let or = 0;
  installProvider('fake', {
    complete: async () => { gem += 1; throw new TypeError('fetch failed'); },
  });
  installProvider('openrouter', {
    complete: async () => { or += 1; return { text: 'riserva', usage: {} }; },
  });
  const r = await P.completeWithFallback({
    attempts: [attempt('fake'), attempt('openrouter')], messages: [],
  });
  assert.equal(r.text, 'riserva');
  assert.equal(gem, 2, 'il primo provider va ritentato una volta prima del ripiego');
  assert.equal(or, 1);
});

test('errore HTTP (400): nessun ritentativo, ritornerebbe identico', async () => {
  let calls = 0;
  installProvider('fake', {
    complete: async () => {
      calls += 1;
      throw Object.assign(new Error('Gemini 400: Bad Request'), { status: 400, provider: 'fake' });
    },
  });
  await assert.rejects(
    P.completeWithFallback({ attempts: [attempt('fake')], messages: [] }),
    /400/,
  );
  assert.equal(calls, 1, 'un 400 non va ritentato');
});

test('streaming: guasto di rete prima di qualsiasi delta → ritentato', async () => {
  let calls = 0;
  installProvider('fake', {
    streamComplete: async ({ onDelta }) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      onDelta && onDelta('ciao');
      return { text: 'ciao', usage: {} };
    },
  });
  let acc = '';
  const r = await P.streamCompleteWithFallback({
    attempts: [attempt('fake')], messages: [], onDelta: (d) => { acc += d; },
  });
  assert.equal(r.text, 'ciao');
  assert.equal(acc, 'ciao');
  assert.equal(calls, 2);
});

test('streaming caduto a metà: il buffer parziale viene azzerato prima di ritentare', async () => {
  let calls = 0; let resets = 0;
  installProvider('fake', {
    streamComplete: async ({ onDelta }) => {
      calls += 1;
      onDelta && onDelta(calls === 1 ? 'mezza ri' : 'risposta intera');
      if (calls === 1) throw new TypeError('fetch failed');
      return { text: 'risposta intera', usage: {} };
    },
  });
  let acc = '';
  const r = await P.streamCompleteWithFallback({
    attempts: [attempt('fake')],
    messages: [],
    onDelta: (d) => { acc += d; },
    onReset: () => { resets += 1; acc = ''; },
  });
  assert.equal(r.text, 'risposta intera');
  assert.equal(resets, 1, 'il chiamante doveva essere avvisato di buttare il parziale');
  assert.equal(acc, 'risposta intera', 'niente testo incollato al pezzo troncato');
});

test('streaming caduto a metà senza onReset: non si ritenta (meglio il ripiego)', async () => {
  let calls = 0;
  installProvider('fake', {
    streamComplete: async ({ onDelta }) => {
      calls += 1;
      onDelta && onDelta('parziale');
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(P.streamCompleteWithFallback({
    attempts: [attempt('fake')], messages: [], onDelta: () => {},
  }));
  assert.equal(calls, 1);
});
