// #1403.33 giro 1: la parola che annuncia la password vale uguale per le uscite verso un sito e per il filtro dei modelli,
// anche con la «é» scritta a due segni (e + accento), e un indirizzo dopo «password here» non è una password.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
const G = globalThis.SN_GUARDIANO_STATICO;
const P = require('../../../src/shared/pavimento.js');
const valori = (xs) => xs.map((x) => x.valore);

test('r1 la «é» scritta con l\'accento a parte annuncia la password come quella intera', () => {
  const t = 'Ciao, la password é Mela!Verde77';
  expect(valori(G.segretiInUscita(t))).toContain('Mela!Verde77');
  expect(P.oscura(t)).not.toContain('Mela!Verde77');
});

test('r2 il collegamento dopo «reset your password here» non è una password in uscita', () => {
  for (const t of [
    'Reset your password here https://example.com/reset?t=abc123',
    'You can change your password here www.example.com/account?id=42',
  ]) {
    expect(valori(G.segretiInUscita(t)), t).toEqual([]);
  }
  // Una password vera dopo «here» resta presa.
  expect(valori(G.segretiInUscita('your new password here Mela!Verde77'))).toContain('Mela!Verde77');
});
