// Verifica #732 giro 5: due parole comuni attaccate che a cavallo formano un marchio (the+bay, multi+cloud, big+mail) non sono il marchio.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate } = require('../../../src/main/services/safebrowse/engine.js');
require('../../../src/shared/linkSospetto.js');
const L = globalThis.SN_LINK_SOSPETTO;

test('r2 thebay, bluebay, multicloud, apicloud, bigmail, mamazone, amazônia: nessun avviso né all\'apertura né dal tasto destro', () => {
  for (const h of ['thebay.com', 'bluebay.com', 'thebay.github.io', 'multicloud.io', 'apicloud.com', 'bigmail.com', 'kingmail.it', 'mamazone.com', 'amazônia.com.br']) {
    const u = 'https://' + h + '/';
    expect(evaluate(u).level, h + ' apertura').toBe('safe');
    expect(L.analizza(u), h + ' tasto destro').toEqual([]);
  }
});
