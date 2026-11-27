// #2695.7 giro 1: l'etichetta di un segreto chiusa fra due segni di enfasi diversi (grassetto più corsivo con segni
// misti) o fra apici inversi, barrata o evidenziata lascia passare il valore al pavimento e al correttore.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/pavimento.js');
const P = globalThis.SN_PAVIMENTO;
const C = require('../../../src/main/services/correttoreRiservati.js');

const CASI = [
  ['**_Password:_** Nyckel!2024', 'Nyckel!2024'],
  ['_**Password:**_ Nyckel!2024', 'Nyckel!2024'],
  ['| **_Password:_** | Nyckel!2024 |', 'Nyckel!2024'],
  ['**_PIN:_** 4821', '4821'],
  ['_**PIN:**_ 4821', '4821'],
  ['__*PIN:*__ 4821', '4821'],
  ['**_CVV:_** 123', '123'],
  ['_**CVV:**_ 123', '123'],
  ['*__CVV:__* 123', '123'],
  ['| _**CVV:**_ | 123 |', '123'],
  ['`Password:` Nyckel!2024', 'Nyckel!2024'],
  ['`PIN:` 4821', '4821'],
  ['`CVV:` 123', '123'],
  ['~~PIN:~~ 4821', '4821'],
  ['~~CVV:~~ 123', '123'],
  ['==Password:== Nyckel!2024', 'Nyckel!2024'],
];

test('r1 il pavimento toglie il valore dietro un\'etichetta con enfasi mista o altri segni', () => {
  const passati = CASI.filter(([t, v]) => P.oscura(t).includes(v)).map(([t]) => t);
  expect(passati).toEqual([]);
});

test('r1 il correttore toglie il valore dietro un\'etichetta con enfasi mista o altri segni', () => {
  const passati = CASI.filter(([t, v]) => C.oscura(t).includes(v)).map(([t]) => t);
  expect(passati).toEqual([]);
});
