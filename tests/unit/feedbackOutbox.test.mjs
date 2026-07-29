// Unit test per src/main/services/feedbackOutbox.js — la coda d'invio del
// feedback (#341). Verifica il comportamento che il feedback chiede davvero:
//
//   1. premuto "Invia" senza rete, il feedback NON si perde: resta in coda e
//      persistito (il box può sparire subito lato utente);
//   2. quando la connessione TORNA, viene inviato da solo e sparisce dalla coda
//      (anche dal persistito);
//   3. l'invio è idempotente: due accodamenti della stessa bozza = una voce,
//      una sola submit → niente duplicati.
//
// Pura logica → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ---- ambiente finto (storage in memoria + SN_FEEDBACK mock) ----
function setup() {
  const store = new Map();
  globalThis.SN_CONST = { STORAGE_KEYS: { FEEDBACK_OUTBOX: 'feedbackOutbox' } };
  globalThis.SN_STORAGE = {
    async getRaw(key, fallback) { return store.has(key) ? store.get(key) : fallback; },
    async setRaw(key, value) { store.set(key, value); },
  };
  const state = { online: false, calls: [] };
  globalThis.SN_FEEDBACK = {
    fallbackName: (t) => String(t || '').split(/\s+/).slice(0, 3).join(' '),
    async submit(payload) {
      state.calls.push(payload);
      if (!state.online) throw new Error('timeout — controlla la rete');
      return { id: 'srv_' + payload.submissionId, failed: [] };
    },
  };
  require(join(ROOT, 'src', 'main', 'services', 'feedbackOutbox.js'));
  const OB = globalThis.SN_FEEDBACK_OUTBOX;
  OB._reset();
  OB._setAuto(false); // niente timer automatici: pilotiamo flush() a mano
  return { OB, state, store };
}

test('offline: il feedback resta in coda e persistito (non si perde)', async () => {
  const { OB, state, store } = setup();
  state.online = false;

  await OB.enqueue({ submissionId: 's1', text: 'ciao filo', images: [] });
  assert.equal(OB.size(), 1, 'il feedback deve essere in coda');
  assert.deepEqual((store.get('feedbackOutbox') || []).map((x) => x.id), ['s1'],
    'la coda deve essere persistita su storage');

  const drained = await OB.flush(); // tentativo mentre è offline
  assert.equal(drained, false, 'offline: la coda NON si svuota');
  assert.equal(OB.size(), 1, 'offline: il feedback resta in coda');
  assert.equal((store.get('feedbackOutbox') || []).length, 1, 'resta persistito');
});

test('la connessione torna: il feedback parte e sparisce dalla coda', async () => {
  const { OB, state, store } = setup();
  state.online = false;
  await OB.enqueue({ submissionId: 's2', text: 'grazie', images: [] });
  await OB.flush();
  assert.equal(OB.size(), 1);

  // Connessione ripristinata → il prossimo tentativo consegna e svuota.
  state.online = true;
  const drained = await OB.flush();
  assert.equal(drained, true, 'online: la coda si svuota');
  assert.equal(OB.size(), 0, 'il feedback è stato inviato e rimosso');
  assert.deepEqual(store.get('feedbackOutbox'), [], 'anche il persistito è vuoto');

  // È davvero arrivato al submit, con il titolo generato al momento dell'invio.
  const sent = state.calls[state.calls.length - 1];
  assert.equal(sent.submissionId, 's2');
  assert.equal(typeof sent.name, 'string');
  assert.ok(sent.name.length > 0, 'il titolo breve deve essere valorizzato');
});

test('idempotenza: due accodamenti della stessa bozza = una sola voce', async () => {
  const { OB, state } = setup();
  state.online = false;
  await OB.enqueue({ submissionId: 'dup', text: 'x' });
  await OB.enqueue({ submissionId: 'dup', text: 'x' });
  assert.equal(OB.size(), 1, 'stesso submissionId non deve duplicare la coda');

  state.online = true;
  await OB.flush();
  assert.equal(OB.size(), 0);
  const forDup = state.calls.filter((c) => c.submissionId === 'dup');
  assert.equal(forDup.length, 1, 'una sola submit per la stessa bozza');
});

test('il persistito sopravvive a un "riavvio" (nuova istanza legge la coda)', async () => {
  const { OB, state, store } = setup();
  state.online = false;
  await OB.enqueue({ submissionId: 's3', text: 'offline poi riavvio' });
  assert.equal((store.get('feedbackOutbox') || []).length, 1);

  // Simula riavvio: azzera lo stato in memoria ma NON lo storage, poi ricarica.
  OB._reset();
  OB._setAuto(false);
  state.online = true;
  const drained = await OB.flush(); // flush() fa load() dal persistito
  assert.equal(drained, true, 'dopo il riavvio la coda persistita viene smaltita');
  assert.equal(OB.size(), 0);
  assert.ok(state.calls.some((c) => c.submissionId === 's3'), 'il feedback salvato è stato inviato');
});
