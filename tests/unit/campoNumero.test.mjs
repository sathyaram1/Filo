// Unit test di src/shared/campoNumero.js (SN_CAMPO_NUMERO) — la manopola
// numerica delle sette impostazioni dei crediti (#652). Qui si prova la parte
// PURA: cosa è un numero buono e cosa si dice quando non lo è. La parte col
// DOM la prova lo spec Playwright della pagina dell'owner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/campoNumero.js');
const C = globalThis.SN_CAMPO_NUMERO;

const CREDITI = { min: 0, max: 1000, intero: true, etichetta: 'Crediti al giorno' };

test('un intero dentro i limiti passa, e passano anche gli estremi', () => {
  assert.deepEqual(C.leggi('100', CREDITI), { ok: true, valore: 100 });
  assert.deepEqual(C.leggi('0', CREDITI), { ok: true, valore: 0 }, 'zero è un valore, non un campo vuoto');
  assert.deepEqual(C.leggi('1000', CREDITI), { ok: true, valore: 1000 });
  assert.deepEqual(C.leggi(' 42 ', CREDITI), { ok: true, valore: 42 }, 'gli spazi intorno non contano');
  assert.deepEqual(C.leggi(7, CREDITI), { ok: true, valore: 7 }, 'anche un numero già numero');
});

test('vuoto, testo, decimali, negativi e fuori scala si rifiutano, ciascuno per il suo motivo', () => {
  assert.equal(C.leggi('', CREDITI).motivo, C.MOTIVI.VUOTO);
  assert.equal(C.leggi('   ', CREDITI).motivo, C.MOTIVI.VUOTO, 'soli spazi è vuoto');
  assert.equal(C.leggi(null, CREDITI).motivo, C.MOTIVI.VUOTO);
  assert.equal(C.leggi('cento', CREDITI).motivo, C.MOTIVI.NON_NUMERO);
  assert.equal(C.leggi('12abc', CREDITI).motivo, C.MOTIVI.NON_NUMERO);
  assert.equal(C.leggi('1e400', CREDITI).motivo, C.MOTIVI.NON_NUMERO, 'infinito non è un numero scrivibile');
  assert.equal(C.leggi('10.7', CREDITI).motivo, C.MOTIVI.NON_INTERO);
  assert.equal(C.leggi('10,7', CREDITI).motivo, C.MOTIVI.NON_INTERO, 'la virgola è un decimale, non si butta via');
  assert.equal(C.leggi('-1', CREDITI).motivo, C.MOTIVI.SOTTO);
  assert.equal(C.leggi('1001', CREDITI).motivo, C.MOTIVI.SOPRA);
});

test('«10,5» non diventa «105»: la virgola si legge come decimale', () => {
  // Con i decimali ammessi il numero vale dieci e mezzo, non centocinque.
  assert.deepEqual(C.leggi('10,5', { intero: false }), { ok: true, valore: 10.5 });
});

test('le frasi di rifiuto dicono cosa fare, col nome della manopola davanti', () => {
  assert.equal(C.frase(C.MOTIVI.VUOTO, CREDITI), 'Crediti al giorno: scrivi un numero.');
  assert.equal(C.frase(C.MOTIVI.NON_NUMERO, CREDITI), 'Crediti al giorno: ci vuole un numero.');
  assert.equal(C.frase(C.MOTIVI.NON_INTERO, CREDITI), 'Crediti al giorno: un numero intero, senza virgola.');
  assert.equal(C.frase(C.MOTIVI.SOTTO, CREDITI), 'Crediti al giorno: non può essere negativo.',
    'con minimo zero si dice «negativo», non «almeno 0»: è quello che è successo');
  assert.equal(C.frase(C.MOTIVI.SOTTO, { min: 1, etichetta: 'Persone per invito' }), 'Persone per invito: almeno 1.');
  assert.equal(C.frase(C.MOTIVI.SOPRA, CREDITI), 'Crediti al giorno: al massimo 1.000.');
  assert.equal(C.frase(C.MOTIVI.VUOTO, {}), 'scrivi un numero.', 'senza etichetta resta una frase sensata');
});

test('controlla() dà già la frase pronta insieme al motivo', () => {
  const esito = C.controlla('-3', CREDITI);
  assert.equal(esito.ok, false);
  assert.equal(esito.motivo, C.MOTIVI.SOTTO);
  assert.equal(esito.testo, 'Crediti al giorno: non può essere negativo.');
  assert.deepEqual(C.controlla('12', CREDITI), { ok: true, valore: 12 });
});

test('senza limiti dichiarati si controlla solo che sia un intero', () => {
  assert.deepEqual(C.leggi('-500', { intero: true }), { ok: true, valore: -500 });
  assert.equal(C.leggi('0,5', {}).motivo, C.MOTIVI.NON_INTERO, 'l’intero è la regola di default');
});
