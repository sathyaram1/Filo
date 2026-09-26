// Il registro dei feedback mandati da questa installazione (#678): quando si
// torna a chiedere al server, e quando invece si sta zitti.
//
// Senza queste regole la home chiedeva TUTTE le schede pubbliche a ogni
// apertura, per ogni utente: una lettura per scheda esistente, per una
// risposta che cambia una volta ogni mai.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../src/shared/feedbackMine.js');

test('un identificativo nuovo azzera l\'attesa: chi ha appena segnalato non aspetta', () => {
  const ora = 10_000_000_000;
  const prima = { ids: ['a'], checkedAt: ora };
  assert.equal(M.scaduto(prima, ora + 1000), false);
  const dopo = M.conId(prima, 'b');
  assert.deepEqual(dopo.ids, ['a', 'b']);
  assert.equal(dopo.checkedAt, 0);
  assert.equal(M.scaduto(dopo, ora + 1000), true);
});

test('un identificativo già noto non riapre l\'attesa', () => {
  const ora = 10_000_000_000;
  const prima = { ids: ['a'], checkedAt: ora };
  const dopo = M.conId(prima, 'a');
  assert.deepEqual(dopo.ids, ['a']);
  assert.equal(dopo.checkedAt, ora);
});

test('fra un controllo e l\'altro passano ore, non aperture di pagina', () => {
  const ora = 10_000_000_000;
  const stato = { ids: ['a'], checkedAt: ora };
  assert.equal(M.scaduto(stato, ora + 1000), false);
  assert.equal(M.scaduto(stato, ora + M.INTERVALLO_MS - 1), false);
  assert.equal(M.scaduto(stato, ora + M.INTERVALLO_MS), true);
});

test('un\'installazione senza eredità non legge mai tutte le schede', () => {
  const ora = 10_000_000_000;
  assert.equal(M.toccaScansione({ ids: [], checkedAt: 0 }, ora), false);
  assert.equal(M.toccaScansione(M.vuoto(), ora), false);
});

test('l\'eredità scansiona una volta al giorno e si spegne da sola', () => {
  const ora = 10_000_000_000;
  const stato = { ids: [], ereditaFinoA: ora + 5 * 24 * 3600_000, ereditaUltimoGiro: 0 };
  assert.equal(M.toccaScansione(stato, ora), true);

  const dopoUnGiro = { ...stato, ereditaUltimoGiro: ora };
  assert.equal(M.toccaScansione(dopoUnGiro, ora + 3600_000), false);
  assert.equal(M.toccaScansione(dopoUnGiro, ora + M.EREDITA_GIRO_MS), true);

  // Finita la finestra non si rilegge più niente, nemmeno passato un giorno.
  assert.equal(M.toccaScansione(dopoUnGiro, ora + 6 * 24 * 3600_000), false);
});

test('il registro regge quello che trova su disco senza rompersi', () => {
  assert.deepEqual(M.normalizza(null).ids, []);
  assert.deepEqual(M.normalizza('rotto').ids, []);
  assert.deepEqual(M.normalizza({ ids: ['a', 'a', '', null, 'b'] }).ids, ['a', 'b']);
});

test('il tetto degli identificativi butta i PIÙ VECCHI, non i nuovi', () => {
  const troppi = Array.from({ length: M.MAX_ID + 10 }, (_, i) => `id-${i}`);
  const s = M.normalizza({ ids: troppi });
  assert.equal(s.ids.length, M.MAX_ID);
  assert.equal(s.ids[s.ids.length - 1], `id-${M.MAX_ID + 9}`);
  assert.equal(s.ids.includes('id-0'), false);
});

// ── Il timbro del controllo non si porta via quello che è arrivato dopo ─────
// Fra la lettura del registro e il timbro passa una lettura di rete: se in
// mezzo l'utente manda una segnalazione, quell'identificativo non deve
// sparire, e l'attesa non deve ripartire su qualcosa che nessuno ha guardato.

function discoFinto(iniziale) {
  const disco = new Map();
  if (iniziale) disco.set(M.KEY, iniziale);
  globalThis.SN_STORAGE = {
    async getRaw(k, d) { return disco.has(k) ? disco.get(k) : d; },
    async setRaw(k, v) { disco.set(k, v); },
  };
  return disco;
}

test('il timbro tiene gli identificativi arrivati mentre si guardava', async () => {
  const ora = 10_000_000_000;
  const disco = discoFinto({ ids: ['a'], checkedAt: 0 });
  try {
    // Il controllo ha guardato solo 'a'; nel frattempo è arrivato 'b'.
    await M.ricordaId('b');
    await M.segnaControllo(ora, { visti: ['a'] });
    const s = M.normalizza(disco.get(M.KEY));
    assert.deepEqual(s.ids, ['a', 'b']);
    assert.equal(s.checkedAt, 0); // 'b' non è stato guardato: si riguarda subito
  } finally { delete globalThis.SN_STORAGE; }
});

test('guardato tutto: il timbro si mette, e la prossima apertura sta zitta', async () => {
  const ora = 10_000_000_000;
  const disco = discoFinto({ ids: ['a'], checkedAt: 0 });
  try {
    await M.segnaControllo(ora, { visti: ['a'] });
    const s = M.normalizza(disco.get(M.KEY));
    assert.equal(s.checkedAt, ora);
    assert.equal(M.scaduto(s, ora + 1000), false);
  } finally { delete globalThis.SN_STORAGE; }
});

test('la scansione dell\'eredità impara gli identificativi e segna il suo giro', async () => {
  const ora = 10_000_000_000;
  const disco = discoFinto({ ids: [], ereditaFinoA: ora + 10 * 24 * 3600_000, ereditaUltimoGiro: 0 });
  try {
    // Chi scansiona ha guardato anche quello che ha appena imparato.
    await M.segnaControllo(ora, { visti: ['vecchio-1'], impara: ['vecchio-1'], scansione: true });
    const s = M.normalizza(disco.get(M.KEY));
    assert.deepEqual(s.ids, ['vecchio-1']);
    assert.equal(s.ereditaUltimoGiro, ora);
    assert.equal(s.checkedAt, ora);
    // Una scansione al giorno, non a ogni apertura.
    assert.equal(M.toccaScansione(s, ora + 3600_000), false);
  } finally { delete globalThis.SN_STORAGE; }
});
