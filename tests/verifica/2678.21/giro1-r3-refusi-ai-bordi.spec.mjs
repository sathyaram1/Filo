// Verifica #2678.21, giro 1: il refuso di «password» vale solo se la parola comincia per p e finisce per d; un tasto
// sbagliato sulla prima o sull'ultima lettera, o la lettera finale mancante, lascia passare la password in chiaro.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');

const PAROLE = ['passwor', 'passworf', 'passwore', 'passwordf', 'oassword', 'lassword', 'apssword', 'assword', 'paswd'];

test('r3 la parola sbagliata sulla prima o sull’ultima lettera non lascia passare la password', () => {
  const fughe = [];
  for (const w of PAROLE) {
    for (const t of [`la ${w} è Mela!Verde77`, `the ${w} is Mela!Verde77`]) if (P.oscura(t).includes('Mela')) fughe.push(t);
  }
  expect(fughe).toEqual([]);
});
