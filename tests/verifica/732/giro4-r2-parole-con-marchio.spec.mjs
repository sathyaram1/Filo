// Verifica #732 giro 4: parole comuni che contengono un marchio distintivo (amazonite, rosebay) non sono imitazioni.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate } = require('../../../src/main/services/safebrowse/engine.js');
require('../../../src/shared/linkSospetto.js');
const L = globalThis.SN_LINK_SOSPETTO;

test('r2 amazonite, rosebay, forebay: nessun avviso né all\'apertura né dal tasto destro', () => {
  for (const h of ['amazonite.com', 'amazonite-gioielli.it', 'rosebay.com', 'forebay.org', 'rosebay.github.io']) {
    const u = 'https://' + h + '/';
    expect(evaluate(u).level, h + ' apertura').toBe('safe');
    expect(L.analizza(u), h + ' tasto destro').toEqual([]);
  }
});
