// #273 — "Fallback provider AI in streaming lascia testo del tentativo fallito
// in chat": se un provider si interrompe DOPO aver già emesso dei delta (es.
// rete che cade a metà risposta SSE), il router ripiega sul provider successivo
// ma i consumer accumulano i delta con un semplice `buf += delta` → il messaggio
// finale era la concatenazione sporca (pezzo del tentativo fallito + risposta
// del fallback).
//
// Fix: il router emette `onReset` prima di ripartire con l'attempt successivo,
// MA SOLO se l'attempt fallito aveva già emesso qualcosa. Questi test girano il
// router vero con provider finti e asseriscono il SUCCESSO: un consumer che
// azzera il buffer al reset ottiene ESATTAMENTE la risposta pulita del fallback.
// Senza il fix (nessun onReset) il buffer conterrebbe anche i delta del
// tentativo fallito e gli assert diventano rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require(join(__dirname, '..', '..', 'src', 'main', 'services', 'providers', 'index.js'));
const Providers = globalThis.SN_PROVIDERS;

// Installa provider finti su globalThis (il router li risolve per nome).
function withFakeProviders({ fake, openrouter }, run) {
  const origG = globalThis.SN_PROVIDER_FAKE;
  const origO = globalThis.SN_PROVIDER_OPENROUTER;
  globalThis.SN_PROVIDER_FAKE = fake;
  globalThis.SN_PROVIDER_OPENROUTER = openrouter;
  return Promise.resolve(run()).finally(() => {
    globalThis.SN_PROVIDER_FAKE = origG;
    globalThis.SN_PROVIDER_OPENROUTER = origO;
  });
}

const ATTEMPTS = [
  { provider: 'fake', apiKey: 'k1', model: 'g-model' },
  { provider: 'openrouter', apiKey: 'k2', model: 'o-model' },
];

test('fallback a metà stream: onReset viene emesso e il buffer del consumer resta pulito', async () => {
  const events = [];
  let buf = '';
  const res = await withFakeProviders({
    fake: {
      async streamComplete({ onDelta }) {
        onDelta('Questa risposta si interr');
        onDelta('ompe a met');
        throw new Error('network error: stream troncato');
      },
    },
    openrouter: {
      async streamComplete({ onDelta }) {
        onDelta('Risposta ');
        onDelta('pulita.');
        return { text: 'Risposta pulita.', usage: {} };
      },
    },
  }, () => Providers.streamCompleteWithFallback({
    attempts: ATTEMPTS,
    messages: [{ role: 'user', content: 'ciao' }],
    onDelta: (d) => { events.push(['delta', d]); buf += d; },
    onReset: (info) => { events.push(['reset', info]); buf = ''; },
  }));

  // Il reset è arrivato UNA volta, tra i delta del fallito e quelli del fallback.
  const resetIdx = events.findIndex(([t]) => t === 'reset');
  assert.equal(events.filter(([t]) => t === 'reset').length, 1);
  assert.equal(resetIdx, 2, 'il reset deve arrivare dopo i 2 delta del provider fallito');
  assert.deepEqual(events[resetIdx][1], { failed: 'fake', next: 'openrouter' });

  // SUCCESSO: il buffer del consumer è ESATTAMENTE la risposta del fallback,
  // identica al result.text del router (niente testo incollato/rotto).
  assert.equal(buf, 'Risposta pulita.');
  assert.equal(res.text, 'Risposta pulita.');
  assert.equal(res.provider, 'openrouter');
});

test('errore immediato (nessun delta emesso): NESSUN reset, il flusso resta come prima', async () => {
  let resets = 0;
  let buf = '';
  const res = await withFakeProviders({
    fake: {
      async streamComplete() { throw new Error('401 unauthorized'); },
    },
    openrouter: {
      async streamComplete({ onDelta }) {
        onDelta('Tutto ok.');
        return { text: 'Tutto ok.', usage: {} };
      },
    },
  }, () => Providers.streamCompleteWithFallback({
    attempts: ATTEMPTS,
    messages: [{ role: 'user', content: 'ciao' }],
    onDelta: (d) => { buf += d; },
    onReset: () => { resets++; },
  }));
  assert.equal(resets, 0, 'senza delta già emessi il reset non serve e non deve arrivare');
  assert.equal(buf, 'Tutto ok.');
  assert.equal(res.text, 'Tutto ok.');
});

test('anche il solo reasoning già emesso conta come "sporco" e provoca il reset', async () => {
  let resets = 0;
  const res = await withFakeProviders({
    fake: {
      async streamComplete({ onReasoning }) {
        onReasoning('Sto pensando…');
        throw new Error('stream troncato');
      },
    },
    openrouter: {
      async streamComplete({ onDelta }) {
        onDelta('Risposta.');
        return { text: 'Risposta.', usage: {} };
      },
    },
  }, () => Providers.streamCompleteWithFallback({
    attempts: ATTEMPTS,
    messages: [{ role: 'user', content: 'ciao' }],
    onDelta: () => {},
    onReasoning: () => {},
    onReset: () => { resets++; },
  }));
  assert.equal(resets, 1);
  assert.equal(res.text, 'Risposta.');
});

test('ultimo attempt che fallisce a metà: nessun reset (non c\'è un fallback dopo)', async () => {
  let resets = 0;
  await withFakeProviders({
    fake: {
      async streamComplete({ onDelta }) {
        onDelta('parziale');
        throw new Error('boom 1');
      },
    },
    openrouter: {
      async streamComplete({ onDelta }) {
        onDelta('parziale 2');
        throw new Error('boom 2');
      },
    },
  }, () => assert.rejects(
    Providers.streamCompleteWithFallback({
      attempts: ATTEMPTS,
      messages: [{ role: 'user', content: 'ciao' }],
      onDelta: () => {},
      onReset: () => { resets++; },
    }),
    /boom 2/,
  ));
  // Un solo reset (tra attempt 1 e 2); dopo l'ultimo fallimento non ha senso.
  assert.equal(resets, 1);
});

test('retro-compatibilità: consumer senza onReset continua a funzionare', async () => {
  const res = await withFakeProviders({
    fake: {
      async streamComplete({ onDelta }) {
        onDelta('x');
        throw new Error('stream troncato');
      },
    },
    openrouter: {
      async streamComplete({ onDelta }) {
        onDelta('Ok.');
        return { text: 'Ok.', usage: {} };
      },
    },
  }, () => Providers.streamCompleteWithFallback({
    attempts: ATTEMPTS,
    messages: [{ role: 'user', content: 'ciao' }],
    onDelta: () => {},
  }));
  assert.equal(res.text, 'Ok.');
  assert.equal(res.provider, 'openrouter');
});
