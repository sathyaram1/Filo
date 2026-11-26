// Verifica #2678.3, giro 1: la regola verso i modelli e quella verso i siti devono riconoscere lo stesso PIN.
// Logica pura, senza aprire Filo.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../../src/shared/pavimento.js');
require('../../../src/shared/guardianoStatico.js');
const G = globalThis.SN_GUARDIANO_STATICO;
const uscita = (f) => [...G.segretiInUscita(f)].map((x) => x.valore);

test('r2 un PIN senza verbo né due punti, tolto ai modelli, chiede conferma anche verso un sito', () => {
  const f = 'pin del telefono 4821';
  expect(P.oscura(f)).not.toContain('4821');
  expect(uscita(f)).toContain('4821');
});

test('r2 il PIN di fabbrica, che passa ai modelli, non ferma un invio a un sito', () => {
  for (const f of ['il pin di fabbrica del router è 0000', 'il pin predefinito della sim è 1234']) {
    expect(P.oscura(f), f).toBe(f);
    expect(uscita(f), `verso un sito: ${f}`).toEqual([]);
  }
});
