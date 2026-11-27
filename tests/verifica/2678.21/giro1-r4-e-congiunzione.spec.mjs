// Verifica #2678.21, giro 1: la «e» congiunzione letta come «è» toglie al modello il nome di un servizio con le cifre
// («la password e Office365 sono collegati»), che prima arrivava intero.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');

test('r4 la «e» congiunzione davanti a un nome con cifre lascia la frase intera', () => {
  for (const t of ['la password e Office365 sono collegati', 'la password e Windows11 non vanno d’accordo']) {
    expect(P.oscura(t)).toBe(t);
  }
});
