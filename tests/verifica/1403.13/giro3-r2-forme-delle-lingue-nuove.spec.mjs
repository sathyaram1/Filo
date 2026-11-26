// #1403.13 giro 3: forme che in una lingua del lavoro tolgono il codice e in un'altra no: l'articolo prima del numero,
// il futuro, il passato, l'aggettivo dopo «codice», il numero in testa.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

test('r2 articolo, futuro, passato, aggettivo e numero in testa tolgono il codice in tutte le lingue del lavoro', () => {
  for (const [frase, valore] of [
    ['El código generado es 482913', '482913'],
    ['O código gerado é 482913', '482913'],
    ['Kod wygenerowany to 482913', '482913'],
    ['Tu código fue 482913', '482913'],
    ['Der Code ist der 482913', '482913'],
    ['Die PIN ist die 4829', '4829'],
    ['De code wordt 482913', '482913'],
    ['Je eenmalige code is 482913', '482913'],
    ['482913 to Twój kod weryfikacyjny', '482913'],
  ]) {
    expect(P.oscura(frase), frase).not.toContain(valore);
  }
});
