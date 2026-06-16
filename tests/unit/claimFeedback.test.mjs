// Unit test per la logica pura del semaforo sui feedback (scripts/claim-feedback.mjs).
//
// Il semaforo impedisce a due routine cloud avviate a poca distanza di prendere
// in carico lo STESSO feedback. La parte "pura" (decidere se un claim è vivo /
// mio / di un altro) è qui; la parte git (push ff-only) è testata a mano.
//
// Senza il fix, decideAcquire non esisteva e due routine sceglievano lo stesso
// feedback: questi assert diventano rossi se la logica di scadenza/proprietà
// regredisce (es. un claim scaduto trattato come ancora vivo, o quello di
// un'altra routine trattato come libero).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClaim, isClaimLive, decideAcquire, buildClaim, isValidId, claimIdentity,
} from '../../scripts/claim-feedback.mjs';

const NOW = Date.parse('2026-06-16T12:00:00.000Z');
const future = (minutes) => new Date(NOW + minutes * 60000).toISOString();
const past = (minutes) => new Date(NOW - minutes * 60000).toISOString();

test('parseClaim accetta un claim valido e rifiuta input incompleti', () => {
  assert.equal(parseClaim('non-json'), null);
  assert.equal(parseClaim('{"id":"a"}'), null); // manca by/expiresAt
  const c = parseClaim(JSON.stringify({ id: 'a', by: 'r1', expiresAt: future(10) }));
  assert.ok(c && c.id === 'a' && c.by === 'r1');
});

test('isClaimLive: vivo solo se la scadenza è nel futuro', () => {
  assert.equal(isClaimLive({ expiresAt: future(5) }, NOW), true);
  assert.equal(isClaimLive({ expiresAt: past(5) }, NOW), false);
  assert.equal(isClaimLive({ expiresAt: 'boh' }, NOW), false);
  assert.equal(isClaimLive(null, NOW), false);
});

test('decideAcquire: free quando non c\'è claim o è scaduto', () => {
  assert.equal(decideAcquire(null, 'me', NOW), 'free');
  assert.equal(decideAcquire({ by: 'altro', expiresAt: past(1) }, 'me', NOW), 'free');
});

test('decideAcquire: taken quando un\'altra routine ha un claim vivo', () => {
  // Questo è il cuore del lock: se è di un altro ed è vivo, NON lo prendo.
  assert.equal(decideAcquire({ by: 'altra-routine', expiresAt: future(30) }, 'me', NOW), 'taken');
});

test('decideAcquire: mine quando il claim vivo è già mio (rinnovo)', () => {
  assert.equal(decideAcquire({ by: 'me', expiresAt: future(30) }, 'me', NOW), 'mine');
});

test('buildClaim produce una scadenza nel futuro e i campi attesi', () => {
  const c = buildClaim('fb1', 'me', { num: '#22.1' }, NOW);
  assert.equal(c.id, 'fb1');
  assert.equal(c.by, 'me');
  assert.equal(c.num, '#22.1');
  assert.ok(Date.parse(c.expiresAt) > NOW, 'la scadenza deve essere dopo "ora"');
  assert.ok(Date.parse(c.claimedAt) <= Date.parse(c.expiresAt));
  // Un claim appena costruito è vivo e, per la stessa identità, "mine".
  assert.equal(decideAcquire(c, 'me', NOW + 1000), 'mine');
});

test('isValidId rifiuta nomi non adatti a un filename', () => {
  assert.equal(isValidId('abcDEF-123_x'), true);
  assert.equal(isValidId('../etc'), false);
  assert.equal(isValidId('a b'), false);
  assert.equal(isValidId(''), false);
});

test('claimIdentity usa lo slug routine se presente', () => {
  const prev = process.env.FILO_ROUTINE_SLUG;
  process.env.FILO_ROUTINE_SLUG = 'routine-xyz';
  assert.equal(claimIdentity(), 'routine-xyz');
  if (prev === undefined) delete process.env.FILO_ROUTINE_SLUG; else process.env.FILO_ROUTINE_SLUG = prev;
});
