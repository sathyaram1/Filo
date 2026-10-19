// #953 — chi firma un feedback che parte da questa copia di Filo, ovunque nasca: l'owner col suo nome e la sua prova,
// mai col ripiego anonimo; gli altri come sempre. L'accesso Google è finto; il resto è il modulo vero.
// Il giro intero (chat, segnalazione automatica, bacheca) lo prova tests/feedback-owner-firma-ovunque.spec.mjs.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const accesso = { admin: false, caduto: false, token: '', rete: true };
const authFinto = {
  isAdmin: () => accesso.admin,
  accessoOwnerCaduto: () => accesso.caduto,
  getIdToken: async () => { if (!accesso.rete) throw new Error('fetch failed'); return accesso.token; },
};
const caricaOriginale = Module._load;
Module._load = function (request, parent, isMain) {
  if (/auth[\\/]google-auth$/.test(request)) return authFinto;
  return caricaOriginale.call(this, request, parent, isMain);
};
require(join(ROOT, 'src', 'shared', 'feedbackThread.js'));
const Mittente = require(join(ROOT, 'src', 'main', 'services', 'feedbackMittente.js'));
Module._load = caricaOriginale;

let inviati;
let accodati;
beforeEach(() => {
  Object.assign(accesso, { admin: false, caduto: false, token: '', rete: true });
  inviati = [];
  accodati = [];
  globalThis.SN_FEEDBACK = {
    rifiuta: false,
    encryptionUnavailable: () => '',
    encryptionBlockedMessage: (m) => `non cifrabile: ${m}`,
    async submit(payload, opts) {
      inviati.push({ clientId: payload.clientId, opts: opts || null });
      if (this.rifiuta) throw Object.assign(new Error('token admin rifiutato'), { accessoOwner: true });
      return { id: 'doc-1', seq: 9, senderProof: opts && opts.idToken ? 'admin' : '' };
    },
  };
  globalThis.SN_FEEDBACK_OUTBOX = {
    async enqueue(payload, opts) { accodati.push({ clientId: payload.clientId, name: payload.name, opts }); return { id: 'coda-1', queued: true }; },
  };
});

test('l’owner firma col suo nome ovunque nasca il feedback; chi non lo è parte com’è', () => {
  accesso.admin = true;
  assert.deepEqual(Mittente.firma('filo:chat'), { clientId: 'owner:filo:chat', dallOwner: true });
  assert.deepEqual(Mittente.firma('uid:abc'), { clientId: 'owner:uid:abc', dallOwner: true });
  assert.deepEqual(Mittente.firma('abc123'), { clientId: 'owner:abc123', dallOwner: true });
  // Buttato fuori da un rinnovo fallito resta l'owner: quello che manda aspetta che rientri (#912).
  Object.assign(accesso, { admin: false, caduto: true });
  assert.deepEqual(Mittente.firma('filo:chat'), { clientId: 'owner:filo:chat', dallOwner: true });
  // Scritta da Filo dopo aver letto testo di altri: la prova dell'owner, il nome di Filo (#953, scelta C).
  assert.deepEqual(Mittente.firma('filo:chat', { perConto: true }), { clientId: 'filo:chat', dallOwner: true });
  Object.assign(accesso, { caduto: false });
  for (const c of ['filo:chat', 'uid:abc', 'abc123', 'auto:complaint']) {
    assert.deepEqual(Mittente.firma(c), { clientId: c, dallOwner: false }, c);
    assert.deepEqual(Mittente.firma(c, { perConto: true }), { clientId: c, dallOwner: false }, c);
  }
});

test('la spedizione dell’owner parte col token e senza ripiego anonimo', async () => {
  Object.assign(accesso, { admin: true, token: 'tok-owner' });
  const r = await Mittente.spedisciDallOwner({ text: 'x', clientId: 'owner:filo:chat', name: 'Titolo' });
  assert.equal(r.id, 'doc-1');
  assert.deepEqual(inviati, [{ clientId: 'owner:filo:chat', opts: { idToken: 'tok-owner', soloAdmin: true } }]);
  assert.deepEqual(accodati, []);
});

test('senza accesso valido la voce dell’owner va in coda ad aspettarlo, mai da anonima', async () => {
  // Accesso caduto: nessun token, nessuna spedizione, la voce aspetta col titolo che l'utente ha confermato.
  Object.assign(accesso, { admin: false, caduto: true });
  const r = await Mittente.spedisciDallOwner({ text: 'x', clientId: 'owner:filo:chat', name: 'Titolo' });
  assert.deepEqual(r, { id: 'coda-1', queued: true });
  assert.deepEqual(inviati, []);
  assert.deepEqual(accodati, [{ clientId: 'owner:filo:chat', name: 'Titolo', opts: { dallOwner: true } }]);

  // Token rifiutato dal server: un tentativo firmato, poi la coda.
  accodati = [];
  Object.assign(accesso, { admin: true, caduto: false, token: 'tok-scaduto' });
  globalThis.SN_FEEDBACK.rifiuta = true;
  const r2 = await Mittente.spedisciDallOwner({ text: 'x', clientId: 'owner:filo:chat' });
  assert.equal(r2.queued, true);
  assert.equal(inviati.length, 1);
  assert.deepEqual(inviati[0].opts, { idToken: 'tok-scaduto', soloAdmin: true });
  assert.equal(accodati.length, 1);
});

test('la rete che manca resta un errore, e una voce che non si cifrerà non entra in coda', async () => {
  Object.assign(accesso, { admin: true, rete: false });
  await assert.rejects(Mittente.spedisciDallOwner({ text: 'x', clientId: 'owner:filo:chat' }), /fetch failed/);
  assert.deepEqual(accodati, []);

  Object.assign(accesso, { admin: false, caduto: true, rete: true });
  globalThis.SN_FEEDBACK.encryptionUnavailable = () => 'chiave pubblica assente';
  await assert.rejects(Mittente.spedisciDallOwner({ text: 'x', clientId: 'owner:filo:chat' }), /non cifrabile/);
  assert.deepEqual(accodati, []);
});

test('Filo per conto di chi: lo dice la prova, non il nome', () => {
  const TH = globalThis.SN_FEEDBACK_THREAD;
  const casi = [
    [{ clientId: 'owner:filo:chat', senderProof: 'admin' }, 'owner', 'owner'],
    [{ clientId: 'auto:complaint', senderProof: 'admin' }, 'owner', 'filo'],
    [{ clientId: 'auto:capability-gap:x' }, 'user', 'filo'],
    [{ clientId: 'filo:chat' }, 'user', 'filo'],
    // Il nome dell'owner senza la prova è un utente, e non è nemmeno di Filo.
    [{ clientId: 'owner:filo:chat' }, '', 'user'],
    [{ clientId: 'owner:abc', senderProof: 'admin' }, '', 'owner'],
    [{ clientId: 'owner:uid:abc', senderProof: 'admin' }, '', 'owner'],
    [{ clientId: 'c-utente' }, '', 'user'],
    [{}, '', 'user'],
  ];
  for (const [fb, perConto, kind] of casi) {
    assert.equal(TH.filoPerConto(fb), perConto, JSON.stringify(fb));
    assert.equal(TH.authorKind(fb), kind, JSON.stringify(fb));
  }
});
