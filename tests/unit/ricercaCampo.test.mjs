// Sentinella del riconoscimento della ricerca (#824.4): una casella di ricerca non protegge la scheda dalla pulizia, un
// messaggio sì. Il nome del campo da solo non basta, e le parole del suggerimento contano solo intere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/ricercaCampo.js');
const { eRicerca, TESTO_LUNGO } = globalThis.SN_RICERCA_CAMPO;

const area = (tratti) => ({ tag: 'TEXTAREA', righe: 6, lunghezza: 10, ...tratti });
const riga = (tratti) => ({ tag: 'INPUT', tipo: 'text', righe: 1, lunghezza: 10, ...tratti });

test('un\'area di testo a più righe è un messaggio qualunque sia il nome', () => {
  for (const nome of ['query', 'your-query', 'q', 's', 'search']) assert.equal(eRicerca(area({ nome })), false, nome);
  assert.equal(eRicerca(area({ nome: 'query', etichetta: ' Your query' })), false);
});

test('le parole del suggerimento contano solo intere', () => {
  for (const etichetta of [' Research topic', ' Cercasi personale: scrivi qui', ' Researcher name', ' Suchergebnis']) {
    assert.equal(eRicerca(riga({ etichetta })), false, etichetta);
  }
  for (const etichetta of [' Search…', ' Cerca nel sito', 'Ricerca ', ' Buscar productos', ' Rechercher']) {
    assert.equal(eRicerca(riga({ etichetta })), true, etichetta);
  }
});

test('una casella di ricerca vera resta una ricerca', () => {
  assert.equal(eRicerca(riga({ tipo: 'search' })), true);
  assert.equal(eRicerca(riga({ nome: 'q' })), true);
  assert.equal(eRicerca(riga({ ruolo: 'searchbox' })), true);
  assert.equal(eRicerca(riga({ inRicerca: true })), true);
  // La casella dei motori di ricerca è una textarea di una riga: nel modulo di ricerca, o col nome.
  assert.equal(eRicerca(area({ nome: 'q', righe: 1 })), true);
  assert.equal(eRicerca(area({ nome: 'q', inRicerca: true })), true);
});

test('un testo lungo è un messaggio anche in un campo di una riga col nome da ricerca', () => {
  assert.equal(eRicerca(riga({ nome: 'query', lunghezza: TESTO_LUNGO + 1 })), false);
  assert.equal(eRicerca(riga({ etichetta: ' Cerca', lunghezza: TESTO_LUNGO + 1 })), false);
  assert.equal(eRicerca(riga({ nome: 'query', lunghezza: TESTO_LUNGO })), true);
});

test('quello che non è un campo di testo non è una ricerca', () => {
  assert.equal(eRicerca({ tag: 'DIV', nome: 'q' }), false);
  assert.equal(eRicerca(null), false);
});
