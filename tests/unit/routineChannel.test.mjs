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
const { readTicketReply, call, release } = mod;

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
