// #1403.27 giro 3 — una frase usata come password fra virgolette il correttore la toglie intera come il pavimento,
// anche quando comincia con un articolo o una preposizione.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(`../../../src/shared/${m}.js`);
const P = globalThis.SN_PAVIMENTO;
const C = require('../../../src/main/services/correttoreRiservati.js');

test('r1 il correttore toglie intera la frase-password che comincia con un articolo', () => {
  for (const frase of ['Il mio cane si chiama Fido!', 'La mia bici è rossa 7', 'Con calma e gesso 9', 'The quick brown fox 42']) {
    const t = `la password è «${frase}»`;
    expect(P.oscura(t), `pavimento: ${frase}`).toBe(`la password è «${P.SEGNAPOSTO}»`);
    expect(C.oscura(t), `correttore: ${frase}`).toBe(`la password è «${C.SEGNAPOSTO}»`);
  }
});
