// #2678 giro 2: fra virgolette, dopo il verbo o senza separatore, le parole che dicono com'è la password restano,
// come restano senza virgolette.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

const intatto = (frase) => expect(P.oscura(frase), frase).toBe(frase);

test('r2 lo stato della password fra virgolette dopo il verbo resta', () => {
  intatto('la password è "troppo debole"');
  intatto('la password è "scaduta"');
  intatto('la password è «nascosta»');
});

test('r2 il consiglio o l\'errore fra virgolette senza separatore resta', () => {
  intatto('password "troppo corta", riprova');
  intatto('scegli una password “facile da ricordare”');
});
