// Verifica #1403.74 giro 1: il filtro verso i modelli dentro gli indirizzi con la codifica percentuale.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

test('r1 una carta scritta a gruppi dentro un indirizzo codificato non arriva al modello', () => {
  for (const url of [
    'https://x.example/?q=carta%204111%201111%201111%201111',
    'https://www.google.com/search?q=carta+4111+1111+1111+1111',
    'https://x.example/?q=4111%2D1111%2D1111%2D1111',
  ]) {
    const fuori = P.oscura(url);
    expect(fuori, url).toContain(P.SEGNAPOSTO);
    expect(decodeURIComponent(fuori.replace(/\+/g, ' ')).replace(/\D/g, ''), url).not.toContain('4111111111111111');
  }
});

test('r2 una pagina con tanti collegamenti codificati non rallenta il filtro', () => {
  const pagina = (voce) => Array.from({ length: 1500 }, (_, i) => `<a href="https://it.wikipedia.org/wiki/${voce}_${i}">voce ${i}</a>`).join(' ');
  const misura = (t) => {
    P.oscura(t);
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < 3; k++) P.oscura(t);
    return Number(process.hrtime.bigint() - t0) / 3e6;
  };
  const inChiaro = misura(pagina('Città'));
  const codificati = misura(pagina('Citt%C3%A0'));
  expect(codificati).toBeLessThan(inChiaro * 3 + 20);
});
