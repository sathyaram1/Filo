// Verifica #2681.2, giro 1: il CVV annunciato al futuro in inglese o in olandese arriva intero ai modelli.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

test('r1 il CVV al futuro in inglese e in olandese non esce', () => {
  for (const riga of ['The CVV will be 123', 'Your security code will be 482', 'The CVV is going to be 123', 'De CVV wordt 123']) {
    expect(P.oscura(riga), riga).toContain(P.SEGNAPOSTO);
    expect(P.oscura(riga), riga).not.toContain(riga.match(/\d+/)[0]);
  }
});
