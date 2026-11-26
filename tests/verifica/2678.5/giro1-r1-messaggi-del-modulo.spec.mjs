// Verifica #2678.5, giro 1: un messaggio del modulo che comincia con un articolo dopo «Password:» non è la password.
// La correzione toglie le frasi-password che cominciano con un articolo; un avviso di errore o di campo obbligatorio
// scritto dopo l'etichetta deve restare leggibile al modello, come su main.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

const messaggi = [
  'Password: la password inserita non è corretta',
  'Password: il campo è obbligatorio',
  'Password: la password deve contenere una maiuscola',
  'Password: the field is required',
  'Password: the password you entered is incorrect',
];

for (const m of messaggi) {
  test(`r1 resta leggibile: ${m}`, () => {
    expect(P.oscura(m)).toBe(m);
  });
}

test('r1 la frase-password con l’articolo si toglie comunque', () => {
  expect(P.oscura('Password: la casa al mare')).toBe(`Password: ${P.SEGNAPOSTO}`);
});
