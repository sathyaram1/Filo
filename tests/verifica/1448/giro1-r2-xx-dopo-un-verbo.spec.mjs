// Verifica #1448 giro 1, rilievo 2: «xx» da solo dove ci starebbe un numero, dopo un verbo e prima di un nome di cose
// che si contano, è un candidato segnaposto come «ha xx regioni».

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/content/correttoreRegole.js');
const C = globalThis.SN_CORRETTORE;

test('r2 «ha scritto xx sinfonie», «ha vinto xx scudetti», «scrisse xx opere» sono candidati', () => {
  for (const t of ['Mozart ha scritto xx sinfonie', 'La Juve ha vinto xx scudetti', 'Shakespeare scrisse xx opere']) {
    expect(C.segnaposti(t).map((s) => s.segment), t).toEqual(['xx']);
  }
});
