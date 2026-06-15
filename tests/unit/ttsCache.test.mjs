// Unit test per src/shared/ttsCache.js — la cache in-memoria (LRU per byte)
// dell'audio TTS. Risolve la lamentela "rileggere lo stesso pezzo è di nuovo
// lento": la seconda richiesta dello stesso testo deve essere un hit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'ttsCache.js'));

const { createTtsCache } = globalThis.SN_TTS_CACHE;

test('set/get: lo stesso testo torna istantaneo (hit)', () => {
  const c = createTtsCache({ maxBytes: 1024 });
  assert.equal(c.get('k1'), null);
  c.set('k1', { audioBase64: 'AAAA', mimeType: 'audio/x' });
  const hit = c.get('k1');
  assert.ok(hit);
  assert.equal(hit.audioBase64, 'AAAA');
  assert.equal(hit.mimeType, 'audio/x');
});

test('eviction LRU: superato il budget, esce la entry meno recente', () => {
  // budget 10 byte; ogni entry da 4 byte di base64 → ne stanno 2.
  const c = createTtsCache({ maxBytes: 10 });
  c.set('a', { audioBase64: 'AAAA', mimeType: 'm' }); // 4
  c.set('b', { audioBase64: 'BBBB', mimeType: 'm' }); // 8
  // tocca 'a' → diventa la più recente
  assert.ok(c.get('a'));
  c.set('c', { audioBase64: 'CCCC', mimeType: 'm' }); // 12 > 10 → evict il LRU ('b')
  assert.ok(c.get('a'), 'a era stata usata di recente → resta');
  assert.equal(c.get('b'), null, 'b era la meno recente → evitta');
  assert.ok(c.get('c'));
});

test('un singolo elemento più grande del budget non viene memorizzato', () => {
  const c = createTtsCache({ maxBytes: 4 });
  c.set('big', { audioBase64: 'AAAAAAAA', mimeType: 'm' }); // 8 > 4
  assert.equal(c.get('big'), null);
  assert.equal(c.size, 0);
});

test('clear svuota la cache', () => {
  const c = createTtsCache({ maxBytes: 1024 });
  c.set('k', { audioBase64: 'AAAA', mimeType: 'm' });
  assert.equal(c.size, 1);
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(c.get('k'), null);
});

test('re-set della stessa chiave aggiorna i byte senza doppio conteggio', () => {
  const c = createTtsCache({ maxBytes: 1024 });
  c.set('k', { audioBase64: 'AAAA', mimeType: 'm' });
  c.set('k', { audioBase64: 'AAAAAAAA', mimeType: 'm' });
  assert.equal(c.size, 1);
  assert.equal(c.bytes, 8);
});
