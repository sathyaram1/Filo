// Sentinella — senza cifratura del sistema la sessione resta valida per
// l'avvio in corso: quello che `save` accetta, `load` lo restituisce.
//
// Regressione #708: su Linux senza portachiavi (e nei contenitori senza
// schermo delle routine) `save` scartava la sessione e `load` rispondeva
// null nello stesso processo. Chi aveva appena fatto il login non risultava
// loggato, e l'owner non veniva riconosciuto come tale. La rinuncia deve
// essere alla PERSISTENZA fra un avvio e l'altro, non alla sessione.
//
// Fuori da Electron `require('electron')` fallisce, quindi canEncrypt() è
// false: è esattamente la condizione da provare.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const store = require(join(__dirname, '..', '..', 'src', 'main', 'auth', 'token-store.js'));

const SESSIONE = { refreshToken: 'rt-1', email: 'chi@prova.test', name: 'Chi Prova', picture: '' };

test('senza cifratura del sistema la sessione salvata si rilegge nello stesso avvio', () => {
  assert.equal(store.canEncrypt(), false, 'il presupposto della prova: qui non si cifra');
  store.clear();
  assert.equal(store.load(), null, 'si parte da non loggati');

  store.save(SESSIONE);
  assert.deepEqual(store.load(), SESSIONE);
});

test('save dice il vero: senza cifratura NON è finita su disco', () => {
  store.clear();
  assert.equal(store.save(SESSIONE), false);
});

test('il logout porta via anche la sessione tenuta in memoria', () => {
  store.save(SESSIONE);
  store.clear();
  assert.equal(store.load(), null);
});

test('una sessione vuota non sostituisce quella in corso', () => {
  store.clear();
  store.save(SESSIONE);
  store.save(null);
  assert.deepEqual(store.load(), SESSIONE);
});
