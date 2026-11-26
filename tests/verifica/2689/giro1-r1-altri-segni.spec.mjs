// #2689 giro 1: un PIN, un CVV o un codice racchiusi fra segni diversi da tonde, quadre e graffe (acute, parentesi
// larghe, grassetto o codice del markdown) devono sparire come quando sono scritti senza.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/pavimento.js');
const P = globalThis.SN_PAVIMENTO;

test('r1 il codice fra segni che non sono tonde, quadre o graffe non arriva al modello', () => {
  for (const [frase, valore] of [
    ['il PIN è <4821>', '4821'],
    ['il CVV è <123>', '123'],
    ['il PIN è（4821）', '4821'],
    ['il PIN è ‹4821›', '4821'],
    ['il PIN è **4821**', '4821'],
    ['il CVV è **123**', '123'],
    ['il codice è `482913`', '482913'],
    ['il PIN è _4821_', '4821'],
  ]) {
    const fuori = P.oscura(frase);
    expect(fuori, frase).not.toContain(valore);
    expect(fuori, frase).toContain(P.SEGNAPOSTO);
  }
});
