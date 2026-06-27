// Unit test per src/shared/spellLanguages.js — scelta delle lingue del
// correttore nativo (#169). Pre-condizione del bug: l'inglese veniva sempre
// forzato, quindi le parole italiane errate ricevevano suggerimenti inglesi
// ("funzion"→"function"). Questi test diventano rossi se si reintroduce
// l'inglese forzato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'spellLanguages.js'));

const { select } = globalThis.SN_SPELL_LANG;
const AVAIL = ['it', 'en-US', 'en-GB', 'fr', 'de', 'es'];

test('sistema italiano: SOLO italiano, niente inglese forzato', () => {
  const got = select(AVAIL, 'it-IT');
  assert.deepEqual(got, ['it']);
  assert.ok(!got.some((l) => l.toLowerCase().startsWith('en')), 'niente inglese su sistema italiano');
});

test('italiano sempre per primo, poi la lingua di sistema', () => {
  assert.deepEqual(select(AVAIL, 'fr-FR'), ['it', 'fr']);
  assert.deepEqual(select(AVAIL, 'de-DE'), ['it', 'de']);
});

test('sistema inglese: italiano + inglese (l’inglese è la lingua di sistema)', () => {
  assert.deepEqual(select(AVAIL, 'en-US'), ['it', 'en-US']);
});

test('se l’italiano non è disponibile, usa solo la lingua di sistema', () => {
  assert.deepEqual(select(['en-US', 'fr'], 'fr-FR'), ['fr']);
});

test('nessun dizionario disponibile → lista vuota (no-op)', () => {
  assert.deepEqual(select([], 'it-IT'), []);
  assert.deepEqual(select(null, 'it-IT'), []);
});
