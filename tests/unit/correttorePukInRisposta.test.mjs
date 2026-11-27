// #2692.5 — il PUK dato in risposta a chi lo chiede non parte verso i modelli del correttore, come non parte dal
// cancello dei modelli: anche quando la domanda sta nella pagina sopra il campo e la risposta nel campo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/guardianoStatico.js');
require('../../src/shared/urlExfil.js');
const P = require('../../src/shared/pavimento.js');
const R = require('../../src/main/services/correttoreRiservati.js');

// Come la manda la pagina: il campo intero, il pezzo nuovo e il testo della pagina sopra il campo.
const alCorrettore = (sopra, campo) => {
  const p = R.richiestaSenzaRiservati({
    prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra,
    contesto: { prima: sopra, dopo: '' }, candidati: [{ pezzo: campo }],
  });
  return JSON.stringify(p);
};

test('la risposta a «mi dici il puk?» scritta nel campo non arriva al modello del correttore', () => {
  for (const [sopra, campo, puk] of [
    ['Marco: mi dici il puk?\n', 'Luc: 12345678', '12345678'],
    ['Marco: mi dici il puk?\n', '12345678', '12345678'],
    ['Marco: mi dici il puk?', '12345678', '12345678'],
    ['Marco: mi dai il puk?\n', 'Luc: è sempre 87654321', '87654321'],
    ['[15:42, 26/11/2026] Marco: mi dai il puk della sim?\n', 'è 87654321', '87654321'],
    ['Marco: what is the passcode?\n', '482913', '482913'],
  ]) {
    const fuori = alCorrettore(sopra, campo);
    assert.ok(!fuori.includes(puk), `${JSON.stringify(sopra + campo)} -> ${fuori}`);
    assert.ok(fuori.includes(R.SEGNAPOSTO), sopra + campo);
  }
});

test('domanda e risposta nello stesso testo: il PUK detto col verbo esce dai due cancelli', () => {
  for (const t of ['Marco: mi dai il puk?\nLuc: è 87654321', 'Marco: mi dai il puk della sim?\nLuc: è sempre 87654321']) {
    assert.ok(!P.oscura(t).includes('87654321'), `cancello dei modelli: ${P.oscura(t)}`);
    assert.ok(!R.oscura(t).includes('87654321'), `correttore: ${R.oscura(t)}`);
  }
});

test('un numero che risponde ad altro, o una frase che nomina il PUK, resta intero', () => {
  for (const [sopra, campo] of [
    ['Marco: quanto hai speso?\n', '1250'],
    ['Marco: qual è il numero del tuo ordine?\n', '12345678'],
    ['Marco: hai trovato il puk?\n', 'sì, è scritto sulla scheda della sim'],
    ['', 'puk puk, chi è?'],
  ]) {
    const p = R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra });
    assert.equal(p.nuovo, campo, sopra + campo);
  }
});
