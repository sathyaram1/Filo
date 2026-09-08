// #520 — "si è bloccato e non vedo risposta": `fetch` non ha una scadenza
// propria, quindi un servizio che accetta la connessione e poi tace lascia
// l'attesa aperta per sempre. SN_NET_TIMEOUT è il fondo di quell'attesa.
// Senza il modulo (o con i timer che non scattano) questi assert sono rossi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

require(join(__dirname, '..', '..', 'src', 'shared', 'netTimeout.js'));
const Net = globalThis.SN_NET_TIMEOUT;

const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

test('lo stallo scatta se non arriva niente', async () => {
  const w = Net.watch({ stallMs: 30 });
  assert.equal(w.signal.aborted, false);
  await attesa(80);
  assert.equal(w.signal.aborted, true);
  assert.equal(w.expired, 'stallo');
  w.done();
});

test('touch() rimanda lo stallo: un flusso vivo non viene mai interrotto', async () => {
  const w = Net.watch({ stallMs: 40 });
  for (let i = 0; i < 6; i++) { await attesa(15); w.touch(); }
  assert.equal(w.signal.aborted, false, 'con i pezzi che arrivano non deve scattare');
  assert.equal(w.expired, '');
  w.done();
});

test('il tetto totale scatta anche su un flusso vivo', async () => {
  const w = Net.watch({ stallMs: 40, totalMs: 60 });
  for (let i = 0; i < 8; i++) { await attesa(15); w.touch(); }
  assert.equal(w.signal.aborted, true);
  assert.equal(w.expired, 'tetto');
  w.done();
});

test('done() spegne i timer: dopo la risposta non scatta più niente', async () => {
  const w = Net.watch({ stallMs: 30, totalMs: 50 });
  w.done();
  await attesa(90);
  assert.equal(w.signal.aborted, false);
  assert.equal(w.expired, '');
});

test('il segnale del chiamante annulla, ma NON è una scadenza', async () => {
  const esterno = new AbortController();
  const w = Net.watch({ stallMs: 500, signal: esterno.signal });
  esterno.abort();
  assert.equal(w.signal.aborted, true, 'l\'interruzione del chiamante deve propagarsi');
  assert.equal(w.expired, '', 'chi interrompe è l\'utente: non è un servizio morto');
  w.done();
});

test('un segnale già annullato parte annullato', () => {
  const esterno = new AbortController();
  esterno.abort();
  const w = Net.watch({ stallMs: 500, signal: esterno.signal });
  assert.equal(w.signal.aborted, true);
  w.done();
});

test('timeoutError porta il codice che le chat sanno tradurre', () => {
  const e = Net.timeoutError('stallo', { provider: 'openrouter', cosa: 'il servizio AI' });
  assert.equal(e.code, 'TIMEOUT');
  assert.equal(e.provider, 'openrouter');
  assert.match(e.message, /servizio AI/);
});
