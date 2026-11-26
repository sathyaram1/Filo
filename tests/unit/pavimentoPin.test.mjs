// #2678.3 — il PIN con un complemento fra il nome e il valore («il pin del telefono è 4821») non arriva al modello né
// esce da un'azione senza conferma, con o senza virgolette; una frase che nomina il PIN senza dirne il valore resta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../src/shared/pavimento.js');
require('../../src/shared/guardianoStatico.js');
const G = globalThis.SN_GUARDIANO_STATICO;
const S = P.SEGNAPOSTO;

test('il PIN di una cosa nominata diventa il segnaposto, anche fra virgolette, anche se ha la forma di un anno', () => {
  for (const [frase, atteso] of [
    ['il pin del telefono è 4821', `il pin del telefono è ${S}`],
    ['il pin del telefono è «4821»', `il pin del telefono è «${S}»`],
    ['Il PIN del telefono è "4821"', `Il PIN del telefono è "${S}"`],
    ['il pin del telefono è 1990', `il pin del telefono è ${S}`],
    ['pin del telefono 4821', `pin del telefono ${S}`],
    ['pin del telefono | 4821', `pin del telefono | ${S}`],
    ['Il PIN del mio telefono:\n4821', `Il PIN del mio telefono:\n${S}`],
    ['the pin for my phone is 4821', `the pin for my phone is ${S}`],
    ['codice pin del telefono è 4821', `codice pin del telefono è ${S}`],
    ['PIN code del telefono: 4821', `PIN code del telefono: ${S}`],
    ['il pin che uso per il telefono è 4821', `il pin che uso per il telefono è ${S}`],
    ['Der PIN meines Handys ist 4821', `Der PIN meines Handys ist ${S}`],
    ['El PIN del teléfono es 4821', `El PIN del teléfono es ${S}`],
    ['Le code PIN de mon téléphone est 4821', `Le code PIN de mon téléphone est ${S}`],
  ]) assert.equal(P.oscura(frase), atteso, frase);
});

test('una frase sul PIN senza il suo valore resta com\'è', () => {
  for (const frase of [
    'il pin lo cambio nel 2024',
    'il pin del telefono è cambiato 2 volte',
    'Ho messo un pin sulla mappa al civico 1234',
    'Il PIN del telefono è sbagliato, chiama il 3331234567',
    'Codice cliente: 48213, il pin del telefono non lo so',
    'Il PIN predefinito del telefono è 0000',
    'PIN di fabbrica del telefono: 1234',
  ])assert.equal(P.oscura(frase), frase, frase);
});

test('in uscita il PIN col complemento si riconosce, e il primo verbo chiude il complemento', () => {
  const codici = (t) => G.segretiInUscita(t).filter((x) => x.regola === 'codice').map((x) => x.valore);
  for (const frase of ['il pin del telefono è 4821', 'il pin del telefono è «4821»', 'the pin for my phone is 4821',
    'il pin del telefono: 4821', 'pin%20del%20telefono%20%C3%A8%204821']) assert.deepEqual(codici(frase), ['4821'], frase);
  for (const frase of ['se il pin è giusto la pagina è 2048', 'il pin del telefono è cambiato 2 volte']) {
    assert.deepEqual(codici(frase), [], frase);
  }
});
