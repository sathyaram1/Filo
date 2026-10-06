// Verifica #732 giro 5: un sosia con «rn» per m o «vv» per w avvisa all'apertura come dal tasto destro.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate } = require('../../../src/main/services/safebrowse/engine.js');
require('../../../src/shared/linkSospetto.js');
const L = globalThis.SN_LINK_SOSPETTO;

test('r3 grnail.com, rnicrosoftlogin.com, vvhatsapp-login.com, arnazonlogin.com: l\'apertura avvisa come il tasto destro', () => {
  for (const h of ['grnail.com', 'grnail-login.com', 'rnicrosoftlogin.com', 'vvhatsapp-login.com', 'arnazonlogin.com', 'tvvitterlogin.com']) {
    const u = 'https://' + h + '/';
    expect(L.analizza(u).some((c) => c.startsWith('nome_altrui:')), h + ' tasto destro').toBe(true);
    expect(evaluate(u).level, h + ' apertura').not.toBe('safe');
  }
});
