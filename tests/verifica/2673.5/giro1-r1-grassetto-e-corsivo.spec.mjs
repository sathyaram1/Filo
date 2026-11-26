// #2673.5 giro 1 — un'etichetta della password in grassetto e corsivo insieme («_**Password:**_», «**_Password:_**»)
// copre il valore come «***Password:***»: il pavimento davanti a ogni modello non lo deve lasciar passare.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');

const V = 'Nyckel!2024';

test('r1 grassetto e corsivo annidati coi due punti dentro coprono il valore, sulla riga e sotto', () => {
  for (const riga of [
    `_**Password:**_ ${V}`,
    `**_Password:_** ${V}`,
    `*__Password:__* ${V}`,
    `__*Password:*__ ${V}`,
    `- **_Wi-Fi password:_** ${V}`,
    `_**Password:**_\n${V}`,
  ]) {
    const fuori = P.oscura(riga);
    expect(fuori, riga).not.toContain(V);
    expect(fuori, riga).toContain(P.SEGNAPOSTO);
  }
});
