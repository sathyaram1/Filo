// Verifica #2678.3, giro 1: un inciso fra virgole fra la parola «pin» e il verbo lascia passare il PIN,
// mentre la stessa frase con «password» lo toglie. Logica pura, senza aprire Filo.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../../src/shared/pavimento.js');

test('r1 un inciso fra virgole fra «pin» e il verbo non lascia passare il PIN', () => {
  for (const [frase, valore] of [
    ['il pin, se te lo scordi, è 4821', '4821'],
    ['il pin del telefono, quello nuovo, è 4821', '4821'],
    ['il pin, ti ricordo, è 4821', '4821'],
  ]) expect(P.oscura(frase), frase).not.toContain(valore);
  // La stessa forma con la password funziona già: il PIN deve fare lo stesso.
  expect(P.oscura('la password del wifi, quella nuova, è casa1234')).not.toContain('casa1234');
});
