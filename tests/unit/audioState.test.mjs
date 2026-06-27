// Unit test per src/shared/audioState.js — parsing dello stato audio
// dell'evento `audio-state-changed` tra versioni di Electron (#193).
//
// Pre-condizione del bug: su Electron 33 l'evento passa UN solo argomento con
// `audible` come proprietà dell'evento. Leggendo solo il secondo argomento
// l'audible risultava sempre false → l'indicatore audio sulle tab non compariva.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'audioState.js'));

const { audibleFromEvent } = globalThis.SN_AUDIO_STATE;

test('Electron 32+: audible è una proprietà del primo argomento (evento)', () => {
  // È esattamente la firma che diventava rossa prima del fix.
  assert.equal(audibleFromEvent({ audible: true }, undefined), true);
  assert.equal(audibleFromEvent({ audible: false }, undefined), false);
});

test('Electron <32 forma a oggetto: (event, { audible })', () => {
  assert.equal(audibleFromEvent({}, { audible: true }), true);
  assert.equal(audibleFromEvent({}, { audible: false }), false);
});

test('Electron più vecchio forma booleana: (event, audible)', () => {
  assert.equal(audibleFromEvent({}, true), true);
  assert.equal(audibleFromEvent({}, false), false);
});

test('senza informazioni → non audible (nessun falso positivo)', () => {
  assert.equal(audibleFromEvent({}, undefined), false);
  assert.equal(audibleFromEvent(undefined, undefined), false);
});
