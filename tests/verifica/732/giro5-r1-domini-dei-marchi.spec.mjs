// Verifica #732 giro 5: i siti dei marchi stessi (Postepay, Proton VPN, TransferWise, eBay Inc.) non sono imitazioni.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate } = require('../../../src/main/services/safebrowse/engine.js');
require('../../../src/shared/linkSospetto.js');
const L = globalThis.SN_LINK_SOSPETTO;

test('r1 postepay.it, protonvpn.com, transferwise.com, ebayinc.com, microsoftstore.com, amazontrust.com: nessun avviso né all\'apertura né dal tasto destro', () => {
  for (const h of ['www.postepay.it', 'protonvpn.com', 'account.protonvpn.com', 'transferwise.com', 'ebayinc.com', 'www.microsoftstore.com', 'www.amazontrust.com', 'gitlab-static.net']) {
    const u = 'https://' + h + '/';
    expect(evaluate(u).level, h + ' apertura').toBe('safe');
    expect(L.analizza(u), h + ' tasto destro').toEqual([]);
  }
});
