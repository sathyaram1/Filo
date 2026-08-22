// Unit test del canale autenticato lato routine (scripts/routine-channel.mjs).
//
// COSA TESTIAMO (puro + rete finta, gira in ms):
//   - readTicketReply: la distinzione fra "niente da fare" e "non riesco a
//     sapere se c'è qualcosa da fare". È la stessa distinzione che nel cammino
//     su git è costata un'ondata di lavoro fantasma (una coda illeggibile che
//     sembrava una giornata tranquilla): schiacciarle sullo stesso esito è il
//     bug, non un dettaglio di stile.
//   - call: ritenta i guasti che possono passare da soli, NON i rifiuti.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../../scripts/routine-channel.mjs');
const { readTicketReply, call, release, merge } = mod;

const reply = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => JSON.stringify(body),
});

test('biglietto rilasciato → si lavora', () => {
  const r = readTicketReply(200, { ok: true, work: true, ticket: 'abc' });
  assert.deepEqual(r, { outcome: 'work', ticket: 'abc' });
});

test('routine spente o coda vuota → niente da fare, col motivo', () => {
  assert.deepEqual(readTicketReply(200, { ok: true, work: false, reason: 'off' }),
    { outcome: 'nothing', reason: 'off' });
  assert.deepEqual(readTicketReply(200, { ok: true, work: false, reason: 'idle' }),
    { outcome: 'nothing', reason: 'idle' });
});

test('coda illeggibile NON è "niente da fare": è un guasto', () => {
  const r = readTicketReply(503, { ok: false, reason: 'queue_unreadable' });
  assert.equal(r.outcome, 'fault');
  assert.equal(r.reason, 'queue_unreadable');
});

test('parola d ordine rifiutata → guasto, non giornata tranquilla', () => {
  assert.equal(readTicketReply(401, { ok: false, reason: 'bad_passphrase' }).outcome, 'fault');
});

test('risposta senza biglietto ma con work:true → guasto (mai lavorare alla cieca)', () => {
  assert.equal(readTicketReply(200, { ok: true, work: true }).outcome, 'fault');
});

test('un guasto del server viene ritentato', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls < 3 ? reply(503, { ok: false, reason: 'server_error' })
      : reply(200, { ok: true, work: true, ticket: 't' });
  };
  const r = await call('routineTicket', {}, { fetchImpl, sleep: async () => {}, attempts: 3 });
  assert.equal(calls, 3);
  assert.equal(r.body.ticket, 't');
});

test('un RIFIUTO non viene ritentato (consumerebbe solo il tetto)', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return reply(401, { ok: false, reason: 'bad_ticket' }); };
  const r = await call('routineWork', {}, { fetchImpl, sleep: async () => {}, attempts: 3 });
  assert.equal(calls, 1);
  assert.equal(r.status, 401);
});

test('rete giù per tutti i tentativi → guasto dichiarato, mai un finto "ok"', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('ENOTFOUND'); };
  const r = await call('routineTicket', {}, { fetchImpl, sleep: async () => {}, attempts: 2 });
  assert.equal(calls, 2);
  assert.equal(r.body.ok, false);
  assert.equal(readTicketReply(r.status, r.body).outcome, 'fault');
});

test('una risposta non interpretabile è un guasto, non un successo vuoto', async () => {
  const fetchImpl = async () => ({ status: 200, ok: true, text: async () => 'non-json' });
  const r = await call('routineTicket', {}, { fetchImpl, sleep: async () => {}, attempts: 1 });
  assert.equal(r.body.ok, false);
  assert.equal(readTicketReply(r.status, r.body).outcome, 'fault');
});

// ── Guasto dichiarato (SPEC-RIDISEGNO-MAX.md §12) ───────────────────────────

test('guasto dichiarato da un worker → la richiesta di biglietto esce con GUASTO (il giro si ferma)', () => {
  // Il server risponde fault_declared quando un worker ha dichiarato un guasto
  // nel rilascio: per l'orchestratore è exit 3 — chiudi, MAI rispawnare (con
  // una causa deterministica i worker morirebbero in fila).
  const r = readTicketReply(503, { ok: false, reason: 'fault_declared' });
  assert.equal(r.outcome, 'fault');
  assert.equal(r.reason, 'fault_declared');
});

test('un guasto DICHIARATO non si ritenta: è una risposta, non un interruzione di rete', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return reply(503, { ok: false, reason: 'fault_declared' }); };
  const r = await call('routineTicket', {}, { fetchImpl, sleep: async () => {}, attempts: 3 });
  assert.equal(calls, 1, 'ritentarlo darebbe tre volte lo stesso no, consumando solo tempo');
  assert.equal(readTicketReply(r.status, r.body).outcome, 'fault');
});

test('release con guasto: il motivo viaggia nel corpo, col suo nome', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return reply(200, { ok: true }); };
  const r = await release('tkt-1', 'la coda dei feedback è illeggibile', { fetchImpl, sleep: async () => {} });
  assert.equal(r.ok, true);
  assert.equal(sent.ticket, 'tkt-1');
  assert.equal(sent.fault, 'la coda dei feedback è illeggibile');
});

test('release normale: NESSUN campo fault nel corpo (un rilascio pulito non è un guasto)', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return reply(200, { ok: true }); };
  await release('tkt-1', '', { fetchImpl, sleep: async () => {} });
  assert.equal('fault' in sent, false);
});

// ── La fusione la fa il SERVER (SPEC-RIDISEGNO-MAX.md §10) ──────────────────

test('merge: nel corpo viaggiano SOLO biglietto e ramo — nessun verdetto', async () => {
  // È il contratto che chiude il buco del push diretto: il verdetto L4 il
  // server ce l'ha già registrato, e da qui non si può nemmeno esprimere.
  let sent = null; let url = '';
  const fetchImpl = async (u, init) => { url = u; sent = JSON.parse(init.body); return reply(200, { ok: true, result: 'merged', sha: 'abc' }); };
  const r = await merge('tkt-1', 'worker/42', { fetchImpl, sleep: async () => {} });
  assert.deepEqual(r, { ok: true, result: 'merged', reason: '', sha: 'abc', approval: '' });
  assert.match(url, /\/routineMerge$/);
  assert.deepEqual(Object.keys(sent).sort(), ['branch', 'ticket']);
});

test('merge: blocked e conflict arrivano col motivo; una risposta senza esito è un guasto', async () => {
  const blocked = await merge('t', 'worker/1', {
    fetchImpl: async () => reply(200, { ok: true, result: 'blocked', reason: 'guard_the_guards: firestore.rules' }),
    sleep: async () => {},
  });
  assert.equal(blocked.result, 'blocked');
  assert.match(blocked.reason, /firestore\.rules/);

  // Su un blocco il server dice anche che ha aperto la richiesta per l'owner:
  // se quel campo si perdesse per strada, chi legge il registro crederebbe che
  // il ramo sia perduto proprio quando invece basta un via libera.
  const conRichiesta = await merge('t', 'worker/1', {
    fetchImpl: async () => reply(200, { ok: true, result: 'blocked', reason: 'guard_the_guards', approval: 'req-7' }),
    sleep: async () => {},
  });
  assert.equal(conRichiesta.approval, 'req-7');
  const conflict = await merge('t', 'worker/1', {
    fetchImpl: async () => reply(200, { ok: true, result: 'conflict' }), sleep: async () => {},
  });
  assert.equal(conflict.result, 'conflict');
  // "ok" senza result non è una fusione: è una busta vuota, mai un successo.
  const vuota = await merge('t', 'worker/1', {
    fetchImpl: async () => reply(200, { ok: true }), sleep: async () => {},
  });
  assert.equal(vuota.ok, false);
});

test('merge: un rifiuto del server non si ritenta (il no è una risposta)', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return reply(401, { ok: false, reason: 'not_approved' }); };
  const r = await merge('t', 'worker/1', { fetchImpl, sleep: async () => {}, attempts: 3 });
  assert.equal(calls, 1);
  assert.deepEqual(r, { ok: false, reason: 'not_approved' });
});
