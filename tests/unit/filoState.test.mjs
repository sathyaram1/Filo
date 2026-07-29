// Unit test per src/shared/filoState.js — la sezione CREDITI del "Filo State"
// che finisce nel prompt della chat.
//
// Feedback #359: l'utente vuole poter chiedere a Filo in chat quanti crediti gli
// restano, senza aprire la pagina Crediti. Perché Filo possa rispondere, il saldo
// deve essere presente nel contesto che l'agente riceve (il Filo State). Questi
// test asseriscono che renderForPrompt (funzione pura, no Electron) includa il
// saldo quando c'è, e che ometta la sezione quando il saldo non è disponibile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'filoState.js'));

const FS = globalThis.SN_FILO_STATE;

// Stato minimo valido per renderForPrompt (i campi che tocca sempre).
function baseState(extra = {}) {
  return {
    time: { humanNow: '2026-07-29 mercoledì 10:00', timeSinceLastInteractionMin: null, session: null },
    tabs: [],
    timers: [],
    notifications: [],
    recentActions: [],
    dashboard: null,
    ...extra,
  };
}

test('filoState si registra su globalThis con la sua API', () => {
  assert.ok(FS);
  assert.equal(typeof FS.renderForPrompt, 'function');
  assert.equal(typeof FS.assemble, 'function');
});

test('renderForPrompt include il saldo crediti quando presente', () => {
  const text = FS.renderForPrompt(baseState({ credits: { balance: 842 } }));
  assert.match(text, /CREDITI/, 'manca la sezione CREDITI');
  assert.match(text, /842/, 'manca il saldo nel testo del prompt');
});

test('renderForPrompt omette la sezione CREDITI quando il saldo non è disponibile', () => {
  const text = FS.renderForPrompt(baseState({ credits: null }));
  assert.doesNotMatch(text, /CREDITI/, 'la sezione CREDITI non deve comparire senza saldo');
});

test('renderForPrompt mostra anche un saldo pari a zero (non lo tratta come assente)', () => {
  const text = FS.renderForPrompt(baseState({ credits: { balance: 0 } }));
  assert.match(text, /CREDITI/);
  assert.match(text, /Saldo: 0 crediti/);
});
