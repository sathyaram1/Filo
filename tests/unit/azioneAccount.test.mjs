// #1615 — ACCOUNT, le voci del menu dell'account chieste alla chat: costo, nomi che il modello usa e racconto
// di cosa è successo. Il giro vero (pagina d'accesso, uscita) lo prova tests/account-dalla-chat.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const SHARED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared');
require(join(SHARED, 'actionLevels.js'));
require(join(SHARED, 'actionTools.js'));
const AL = globalThis.SN_ACTION_LEVELS;
const T = globalThis.SN_ACTION_TOOLS;

test('entrare e collegare costano 1, uscire 2; un\'operazione sconosciuta non ha un nome di voce', () => {
  assert.equal(AL.costoFor({ type: 'ACCOUNT', cosa: 'accedi' }), 1);
  assert.equal(AL.costoFor({ type: 'ACCOUNT', cosa: 'collega_google' }), 1);
  assert.equal(AL.costoFor({ type: 'ACCOUNT', cosa: 'esci' }), 2);
  assert.equal(AL.cosaAccount({ cosa: 'cancella' }), '');
  assert.equal(AL.cosaAccount({}), '');
});

test('i nomi che un modello scrive fuori dall\'elenco portano alla stessa voce', () => {
  assert.equal(AL.cosaAccount({ cosa: 'Login' }), 'accedi');
  assert.equal(AL.cosaAccount({ cosa: 'entra' }), 'accedi');
  assert.equal(AL.cosaAccount({ cosa: 'collega google' }), 'collega_google');
  assert.equal(AL.cosaAccount({ azione: 'logout' }), 'esci');
  assert.equal(AL.costoFor({ type: 'ACCOUNT', cosa: 'logout' }), 2, 'l\'uscita costa 2 con qualunque nome');
});

test('il racconto dice la voce premuta davvero, e chi era già dove chiedeva non ha «aperto» niente', () => {
  assert.equal(AL.describeDone({ type: 'ACCOUNT', cosa: 'accedi', _output: { voce: 'accedi' } }), 'Aperto l\'accesso a Filo con Google');
  assert.match(AL.describeDone({ type: 'ACCOUNT', cosa: 'accedi', _output: { voce: 'collega_google' } }), /YouTube, Gmail e Drive/);
  assert.equal(AL.describeDone({ type: 'ACCOUNT', cosa: 'accedi', _output: { gia: 'dentro' } }), 'Eri già dentro Filo col tuo account Google');
  assert.equal(AL.describeDone({ type: 'ACCOUNT', cosa: 'esci', _output: { gia: 'fuori' } }), 'Non eri dentro nessun account di Filo');
  assert.equal(AL.describe({ type: 'ACCOUNT', cosa: 'esci' }), 'Uscire dall\'account di Filo');
});

test('lo strumento offre solo le tre voci, e la descrizione dice di farle invece di spiegarle', () => {
  const def = T.TOOLS.ACCOUNT;
  assert.deepEqual(def.properties.cosa.enum, ['accedi', 'collega_google', 'esci']);
  assert.deepEqual(def.required, ['cosa']);
  assert.match(def.description, /invece di spiegargli dove cliccare/);
});
