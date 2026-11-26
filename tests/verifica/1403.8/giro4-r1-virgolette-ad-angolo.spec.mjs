// Verifica #1403.8 giro 4 (riallineamento): la password fra le virgolette ad angolo con lo spazio dentro, che su main
// diventa il segnaposto, sul ramo deve restare coperta anche in giapponese.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../../src/shared/pavimento.js');
const S = P.SEGNAPOSTO;

test('r1 la password fra 「 」 con lo spazio dentro non arriva al modello', () => {
  expect(P.oscura('la password è 「 Mela!Verde77 」')).toBe(`la password è 「 ${S} 」`);
  expect(P.oscura('la password è 『 Mela!Verde77 』')).toBe(`la password è 『 ${S} 』`);
  expect(P.oscura('パスワードは「 Mela!Verde77 」')).not.toContain('Mela!Verde77');
});
