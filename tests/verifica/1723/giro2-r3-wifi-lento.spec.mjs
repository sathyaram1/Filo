// Verifica #1723, giro 2: un campo lungo con tante «Wi-Fi:» o «SSID:» sulla stessa riga si legge in fretta come un testo
// normale. Misura relativa al lavoro di riferimento: su main costa meno di un'unità, qui il tetto è 20.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { costoInUnita } from '../../helpers/tempoRelativo.mjs';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

for (const [nome, testo] of [
  ['«wifi:» ripetuto', 'wifi: '.repeat(8000)],
  ['«ssid: a» ripetuto', 'ssid: a '.repeat(6000)],
  ['«wifi: a -» ripetuto', 'wifi: a - '.repeat(5000)],
]) {
  test(`r3 ${nome} su una riga sola si legge in fretta`, () => {
    test.setTimeout(120_000);
    const c = costoInUnita(() => R.oscura(testo), { tetto: 20, giri: 3 });
    expect(c.entro, c.come).toBe(true);
  });
}
