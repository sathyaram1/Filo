// Verifica #2673.10, giro 2: tante righe di soli segni di blocco di codice («```» o «> ```») di fila non devono fermare
// il cancello dei modelli. Il confronto è con lo stesso numero di righe di testo, misurato accanto: niente millisecondi fissi.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

function ms(fn) {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

const RIGHE = 2000;
const testo = `Password:\n${'x\n'.repeat(RIGHE)}`;

for (const [nome, riga] of [['citati', '> ```\n'], ['senza citazione', '```\n']]) {
  test(`r1 duemila segni di blocco di codice ${nome} costano quanto duemila righe di testo`, () => {
    test.setTimeout(180_000);
    const base = Math.max(ms(() => P.oscura(testo)), ms(() => P.oscura(testo)), 1);
    const lento = ms(() => P.oscura(`Password:\n${riga.repeat(RIGHE)}`));
    expect(lento / base, `segni ${Math.round(lento)} ms, testo ${Math.round(base)} ms`).toBeLessThan(10);
  });
}
