// Sentinella sulle regole Firestore: cosa NON sceglie chi crea un feedback senza account (#1517).
// Il sotto-numero (#N.k lo scrive solo il server: un #N.1 estraneo fermava #N in coda), l'id del documento (un id
// ricavato da dati pubblici rubava l'idempotenza della riapertura) e le due date (un anonimo sceglieva dove cadere
// nelle liste per data e si nascondeva alle letture a delta su `updatedAt`). Prova col motore vero, a mano:
// feedbackCreateAnonima.motore-vero.mjs. Perché una sentinella sul testo: vedi firestoreRulesPaths.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
const SUBMIT = readFileSync(join(ROOT, 'src', 'shared', 'feedback.js'), 'utf8');

/** Il blocco `allow create` anonimo di /feedback (quello con hasOnly), senza commenti. */
function createAnonimaDiFeedback() {
  const inizio = RULES.indexOf('match /feedback/{doc}');
  assert.ok(inizio >= 0, 'manca il match di /feedback');
  const blocco = RULES.slice(inizio, RULES.indexOf('match /', inizio + 1));
  const creates = blocco.split(/allow create:/).slice(1);
  const anonima = creates.find((c) => c.includes("'createdAt'") && c.includes('hasOnly'));
  assert.ok(anonima, 'manca la create anonima di /feedback con createdAt fra le chiavi ammesse');
  return anonima.slice(0, anonima.indexOf(';')).replace(/\/\/[^\n]*/g, '');
}

test('create anonima: createdAt e updatedAt sono l\'ora della richiesta, obbligatori', () => {
  const c = createAnonimaDiFeedback();
  assert.match(c, /&&\s*request\.resource\.data\.createdAt\s*==\s*request\.time/);
  assert.match(c, /&&\s*request\.resource\.data\.updatedAt\s*==\s*request\.time/);
  // Un «oppure» intorno alle date riaprirebbe la scelta (assenza, un timestamp qualunque, una stringa).
  assert.doesNotMatch(c, /createdAt is (timestamp|string)|updatedAt is timestamp|'(createdAt|updatedAt)' in request/,
    'le date non hanno alternative alla create anonima');
});

test('create anonima: il sotto-numero è assente o 0', () => {
  const c = createAnonimaDiFeedback();
  assert.match(c, /request\.resource\.data\.get\('subSeq', 0\) is int/);
  assert.match(c, /request\.resource\.data\.get\('subSeq', 0\) == 0/);
  assert.doesNotMatch(c, /get\('subSeq', 0\) (>=|<=|>|<)/, 'nessun intervallo di sotto-numeri ammesso');
});

test('create anonima: l\'id del documento ha la forma degli id casuali, 20-128 caratteri', () => {
  const c = createAnonimaDiFeedback();
  assert.match(c, /^\s*if\s+doc\.matches\('\^\[A-Za-z0-9_-\]\{20,128\}\$'\)\s*&&/, 'la prima condizione è la forma dell\'id');
});

test('il client scrive come le regole chiedono: commit con exists false e le date di Firestore', () => {
  const i = SUBMIT.indexOf('async function submit(');
  const corpo = SUBMIT.slice(i, SUBMIT.indexOf('\n  }\n', i));
  assert.match(corpo, /:commit\?key=/, 'la create passa da :commit');
  assert.match(corpo, /currentDocument:\s*\{\s*exists:\s*false\s*\}/, 'una create, non una sovrascrittura');
  assert.match(corpo, /setToServerValue:\s*'REQUEST_TIME'/);
  assert.match(corpo, /\['createdAt',\s*'updatedAt'\]/, 'tutte e due le date');
  assert.doesNotMatch(corpo, /(createdAt|updatedAt):\s*\{\s*timestampValue/, 'nessuna data scritta dal client');
});
