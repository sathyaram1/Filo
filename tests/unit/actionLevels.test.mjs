// Unit test per src/shared/actionLevels.js — il registro azione→livello di
// sicurezza (#146.2): livelli statici, rifiuto delle azioni non registrate,
// livello per-preferenza di IMPOSTA_PREFERENZA e descrizioni per i popup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
// IMPOSTA_PREFERENZA delega il livello al setter in preferences.js.
require(join(__dirname, '..', '..', 'src', 'shared', 'preferences.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'actionLevels.js'));

const AL = globalThis.SN_ACTION_LEVELS;

test('il registro si registra su globalThis con la sua API', () => {
  assert.ok(AL);
  assert.equal(typeof AL.levelFor, 'function');
  assert.equal(typeof AL.describe, 'function');
});

test('azioni reversibili → livello 1 (eseguono senza chiedere)', () => {
  assert.equal(AL.levelFor({ type: 'TIMER', seconds: 60 }), 1);
  assert.equal(AL.levelFor({ type: 'SVEGLIA', time: '8:00' }), 1);
  assert.equal(AL.levelFor({ type: 'SALVA_APPUNTO', text: 'x' }), 1);
  assert.equal(AL.levelFor({ type: 'NAVIGA', url: 'https://x.it' }), 1);
});

test('PULISCI_TAB è livello 2, CANCELLA_ARCHIVIO è livello 3', () => {
  assert.equal(AL.levelFor({ type: 'PULISCI_TAB' }), 2);
  assert.equal(AL.levelFor({ type: 'CANCELLA_ARCHIVIO', query: 'ricette' }), 3);
});

test('le azioni NON registrate non hanno livello (→ il dispatch le rifiuta)', () => {
  assert.equal(AL.levelFor({ type: 'FORMATTA_DISCO' }), null);
  assert.equal(AL.levelFor({ type: '' }), null);
  assert.equal(AL.levelFor(null), null);
  assert.equal(AL.levelFor('TIMER'), null);
});

test('il type è case-insensitive (gli LLM non sono affidabili sul case)', () => {
  assert.equal(AL.levelFor({ type: 'timer', seconds: 60 }), 1);
  assert.equal(AL.levelFor({ type: 'Pulisci_Tab' }), 2);
});

test('IMPOSTA_PREFERENZA: livello per-preferenza, non unico', () => {
  // Estetica → livello 1: si applica subito.
  assert.equal(AL.levelFor({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }), 1);
  // Modalità terminale → dà a Filo accesso alla shell: livello 2.
  assert.equal(AL.levelFor({ type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' }), 2);
  assert.equal(AL.levelFor({ type: 'IMPOSTA_PREFERENZA', chiave: 'shell', valore: 'bash' }), 2);
  // Preferenza sconosciuta → 2 per prudenza.
  assert.equal(AL.levelFor({ type: 'IMPOSTA_PREFERENZA', chiave: 'boh', valore: 'x' }), 2);
});

test('describe spiega in chiaro la modifica per il popup', () => {
  assert.match(AL.describe({ type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' }), /[Tt]erminale/);
  assert.match(AL.describe({ type: 'PULISCI_TAB' }), /archivia/i);
  assert.match(AL.describe({ type: 'CANCELLA_ARCHIVIO', query: 'ricette' }), /DEFINITIVAMENTE/);
  assert.match(AL.describe({ type: 'CANCELLA_ARCHIVIO', query: 'ricette' }), /ricette/);
  assert.equal(AL.describe({ type: 'SCONOSCIUTA' }), '');
});

test('ogni azione registrata ha un livello valido e una describe', () => {
  for (const [type, entry] of Object.entries(AL.REGISTRY)) {
    const lvl = AL.levelFor({ type, chiave: 'tema', valore: 'scuro' });
    assert.ok([1, 2, 3].includes(lvl), `${type} → livello non valido ${lvl}`);
    assert.equal(typeof entry.describe, 'function', `${type} senza describe`);
  }
});
