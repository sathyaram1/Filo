// Verifica #1684, giro 2, rilievo 2: il tempo che resta non deve mai dire «60 min» dentro un'ora e mezza scritta in ore.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/scaricamentiAvanzamento.js');
const A = globalThis.SN_SCARICAMENTI_AVANZAMENTO;

test('r2 a un soffio dalle due ore la riga dice «ancora 2 h», non «ancora 1 h 60 min»', () => {
  for (const s of [7170, 7185, 7199]) {
    expect(A.testoResto(s)).not.toMatch(/\b60 min/);
  }
  expect(A.testoResto(7190)).toBe('ancora 2 h');
});
