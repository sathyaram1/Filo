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

// #2678.10 — detto «codice», il PIN del telefono o della carta vale quello del bancomat, anche senza possessivo.
test('il codice del telefono o della carta diventa il segnaposto, come quello del bancomat', () => {
  for (const [frase, atteso] of [
    ['il codice del telefono è 4821', `il codice del telefono è ${S}`],
    ['il codice della carta è 4821', `il codice della carta è ${S}`],
    ['Il codice della carta è «4821»', `Il codice della carta è «${S}»`],
    ['Il codice del telefono è 1990', `Il codice del telefono è ${S}`],
    ['codice del telefono: 4821', `codice del telefono: ${S}`],
    ['codice del telefono | 4821', `codice del telefono | ${S}`],
    ['il codice del telefono era 4821', `il codice del telefono era ${S}`],
    ['il codice della sim è 4821', `il codice della sim è ${S}`],
    ['the phone code is 4821', `the phone code is ${S}`],
    ['The card code: 4821', `The card code: ${S}`],
    ['le code du téléphone est 4821', `le code du téléphone est ${S}`],
    ['el código del teléfono es 4821', `el código del teléfono es ${S}`],
  ]) assert.equal(P.oscura(frase), atteso, frase);
  for (const frase of [
    'il codice del telefono del cliente è 4821',
    'Il codice IMEI del telefono è 35123456',
    'Il codice predefinito del telefono è 0000',
    'il codice del telefono è cambiato 2 volte',
    'Il codice del telefono è sbagliato, chiama il 3331234567',
    'the phone code for Italy is 0039',
  ]) assert.equal(P.oscura(frase), frase, frase);
});

// Senza possessivo l'etichetta chiude come quella col possessivo: chi possiede il telefono, un aggettivo, l'articolo,
// le maiuscole, un avverbio, la virgola; e i nomi comuni del cellulare e delle carte.
test('il codice del telefono o della carta senza possessivo, in ogni forma di quello del cellulare', () => {
  for (const frase of [
    'il codice del telefono di mia madre è 4821',
    'il codice del telefono di Marco è 4821',
    'il codice del telefono di lavoro è 4821',
    'il codice del telefono aziendale è 4821',
    'il codice del telefono nuovo è 4821',
    'il codice del vecchio telefono è 4821',
    'il telefono ha il codice 4821',
    'il codice del telefono è il 4821',
    'il codice del telefono è: 4821',
    'il codice del telefono È 4821',
    'IL CODICE DEL TELEFONO È 4821',
    'il codice del telefono è sempre 4821',
    'il codice del telefono, 4821',
    'il codice della carta è ancora 4821',
    'il codice del cell è 4821',
    'il codice della postepay è 4821',
    'il codice della prepagata è 4821',
    'il codice della mastercard è 4821',
    'il codice della revolut è 4821',
    'el código del teléfono de mi madre es 4821',
    'le code du téléphone de ma mère est 4821',
  ]) assert.equal(P.oscura(frase).includes('4821'), false, frase);
  for (const frase of [
    'il codice del telefono del cliente è 4821',
    'il telefono del cliente ha il codice 4821',
    'el código del teléfono del cliente es 4821',
    'le code du téléphone du client est 4821',
    'il codice prodotto del telefono è 4821',
    'codice articolo telefono 4821',
    'il codice del telefono è cambiato nel 4821',
    'The serial code of my phone is 5200',
  ]) assert.equal(P.oscura(frase), frase, frase);
});

test('un\'etichetta lunga senza chiusura non rallenta il pavimento', () => {
  const t = `il codice ${'del nuovo vecchio di mia '.repeat(400)}telefono x 4821`;
  const inizio = Date.now();
  P.oscura(t);
  assert.ok(Date.now() - inizio < 2000, `${Date.now() - inizio} ms`);
});

test('in uscita il PIN col complemento si riconosce, e il primo verbo chiude il complemento', () => {
  const codici = (t) => G.segretiInUscita(t).filter((x) => x.regola === 'codice').map((x) => x.valore);
  for (const frase of ['il pin del telefono è 4821', 'il pin del telefono è «4821»', 'the pin for my phone is 4821',
    'il pin del telefono: 4821', 'pin%20del%20telefono%20%C3%A8%204821']) assert.deepEqual(codici(frase), ['4821'], frase);
  for (const frase of ['se il pin è giusto la pagina è 2048', 'il pin del telefono è cambiato 2 volte']) {
    assert.deepEqual(codici(frase), [], frase);
  }
});
