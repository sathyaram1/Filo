// Unit test di src/shared/routineSessioni.js (SN_ROUTINE_SESSIONI): le regole
// su quante sessioni delle routine partono insieme, da quale account e quali
// account sono esclusi. Le applicano sia la pagina di gestione sia il main.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/routineSessioni.js');
const RS = globalThis.SN_ROUTINE_SESSIONI;
const A = globalThis.SN_CONST.AUTOMATION;

test('l\'intervallo delle sessioni è suo, non quello dei bilanci', () => {
  assert.equal(A.MAX_SESSIONS_MIN, 1, 'zero sarebbe un interruttore master di nascosto');
  assert.equal(A.MAX_SESSIONS_MAX, 20);
  assert.equal(A.MAX_SESSIONS_DEFAULT, 1);
  assert.notEqual(A.MAX_SESSIONS_MIN, A.CAP_MIN, 'i bilanci partono da 0, le sessioni no');
  assert.notEqual(A.MAX_SESSIONS_MAX, A.CAP_MAX);
});

test('un documento senza i campi vale come il comportamento di oggi', () => {
  assert.deepEqual(RS.leggiDoc({}), {
    maxSessions: 1, priorityAccount: '', accountAOff: false, accountBOff: false,
  });
  assert.deepEqual(RS.leggiDoc(null), RS.leggiDoc({}));
  assert.deepEqual(RS.leggiDoc(undefined), RS.leggiDoc({}));
});

test('il documento si legge com\'è, e un valore storto non fa esplodere la pagina', () => {
  assert.deepEqual(RS.leggiDoc({
    maxSessions: 7, priorityAccount: 'B', accountAOff: true, accountBOff: false,
  }), { maxSessions: 7, priorityAccount: 'B', accountAOff: true, accountBOff: false });
  // Firestore rende gli interi come stringhe: «5» è cinque, non un guasto.
  assert.equal(RS.leggiDoc({ maxSessions: '5' }).maxSessions, 5);
  assert.equal(RS.leggiDoc({ maxSessions: 99 }).maxSessions, 20, 'in lettura si riporta nell\'intervallo');
  assert.equal(RS.leggiDoc({ maxSessions: 0 }).maxSessions, 1);
  assert.equal(RS.leggiDoc({ maxSessions: 'tante' }).maxSessions, 1);
  assert.equal(RS.leggiDoc({ priorityAccount: 'C' }).priorityAccount, '');
  assert.equal(RS.leggiDoc({ accountAOff: 'sì' }).accountAOff, false, 'solo un vero booleano esclude');
});

test('si scrivono SOLO i campi ricevuti', () => {
  assert.deepEqual(RS.valida({}), { ok: true, valori: {} });
  assert.deepEqual(RS.valida({ accountBOff: true }), { ok: true, valori: { accountBOff: true } });
  assert.deepEqual(RS.valida({ maxSessions: 4 }), { ok: true, valori: { maxSessions: 4 } });
  const tutti = RS.valida({ maxSessions: 3, priorityAccount: 'A', accountAOff: false, accountBOff: true });
  assert.deepEqual(tutti.valori, { maxSessions: 3, priorityAccount: 'A', accountAOff: false, accountBOff: true });
});

test('le sessioni fuori intervallo si rifiutano dicendo l\'intervallo, senza correggere', () => {
  for (const storto of [0, -3, 21, 100, 1.5, '', '   ', 'tre', '1e400', NaN, true]) {
    const esito = RS.valida({ maxSessions: storto });
    assert.equal(esito.ok, false, `${String(storto)} non deve passare`);
    assert.match(esito.testo, /da 1 a 20/, 'il rifiuto dice qual è l\'intervallo');
    assert.equal(esito.valori, undefined, 'niente valore = niente scrittura');
  }
  // Gli estremi sono validi, e la virgola all'italiana si legge.
  assert.equal(RS.valida({ maxSessions: 1 }).valori.maxSessions, 1);
  assert.equal(RS.valida({ maxSessions: '20' }).valori.maxSessions, 20);
  assert.equal(RS.valida({ maxSessions: ' 6 ' }).valori.maxSessions, 6);
  assert.equal(RS.valida({ maxSessions: '2,0' }).valori.maxSessions, 2);
});

test('l\'account prioritario è A, B o nessuno dei due', () => {
  for (const buono of ['', 'A', 'B']) {
    assert.equal(RS.valida({ priorityAccount: buono }).valori.priorityAccount, buono);
  }
  for (const storto of ['a', 'C', 'AB', 1, true, ' ']) {
    const esito = RS.valida({ priorityAccount: storto });
    assert.equal(esito.ok, false, `${String(storto)} non è un account`);
    assert.match(esito.testo, /Non salvato/);
  }
});

test('un interruttore vuole un booleano vero, non «true» scritto a mano', () => {
  assert.deepEqual(RS.valida({ accountAOff: false }).valori, { accountAOff: false });
  for (const storto of ['true', 1, 0, 'off']) {
    assert.equal(RS.valida({ accountAOff: storto }).ok, false);
    assert.equal(RS.valida({ accountBOff: storto }).ok, false);
  }
});

test('esclusi tutti e due: nessuna sessione parte, e si può sapere', () => {
  assert.equal(RS.nessunAccount({ accountAOff: true, accountBOff: true }), true);
  assert.equal(RS.nessunAccount({ accountAOff: true, accountBOff: false }), false);
  assert.equal(RS.nessunAccount(RS.leggiDoc({})), false);
  // Escludere il prioritario non è un caso da segnalare: il server passa all'altro.
  assert.equal(RS.nessunAccount(RS.leggiDoc({ priorityAccount: 'A', accountAOff: true })), false);
});
