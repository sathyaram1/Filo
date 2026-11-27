// Verifica #2673.10, giro 2: un testo con tante righe «> ```» di fila non deve fermare il cancello dei modelli.
// Il confronto è con lo stesso testo senza il segno di citazione, misurato accanto: niente millisecondi fissi.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

function ms(fn) {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

test('r1 duemila righe di blocchi di codice citati costano quanto le stesse righe senza citazione', () => {
  test.setTimeout(180_000);
  const citato = `Password:\n${'> ```\n'.repeat(2000)}`;
  const semplice = `Password:\n${'```\n'.repeat(2000)}`;
  const base = Math.max(ms(() => P.oscura(semplice)), ms(() => P.oscura(semplice)), 1);
  const lento = ms(() => P.oscura(citato));
  expect(lento / base, `citato ${Math.round(lento)} ms, senza citazione ${Math.round(base)} ms`).toBeLessThan(10);
});
