// Verifica #2673.10, giro 5: righe di sottolineatura («===») ripetute sotto «Password» non devono fermare la lettura.
// Il tempo si confronta con un testo di riferimento della stessa lunghezza, non con una soglia fissa.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');
const C = require('../../../src/main/services/correttoreRiservati.js');

const N = 2000;
const ms = (f, t) => { const t0 = process.hrtime.bigint(); f(t); return Number(process.hrtime.bigint() - t0) / 1e6; };
const migliore = (f, t) => Math.min(ms(f, t), ms(f, t));

const CASI = {
  'sottolineature «========»': 'Password\n' + '========\n'.repeat(N),
  'sottolineature citate «> ===»': '> Password\n' + '> ===\n'.repeat(N),
  'etichetta in grassetto e «===»': '**Password**\n' + '===\n'.repeat(N),
};
const riferimento = (t) => t.split('\n')[0] + '\n' + 'abcdefgh\n'.repeat(Math.ceil(t.length / 9));

for (const [nome, testo] of Object.entries(CASI)) {
  test(`r1 ${nome}: il cancello e il correttore la leggono nei tempi di un testo normale`, () => {
    test.setTimeout(180_000);
    const rif = riferimento(testo);
    for (const [chi, f] of [['cancello', P.oscura], ['correttore', C.oscura]]) {
      const base = migliore(f, rif);
      const tempo = migliore(f, testo);
      expect(tempo, `${chi}: ${tempo.toFixed(0)} ms contro ${base.toFixed(0)} ms del riferimento`).toBeLessThan(base * 10);
    }
  });
}
