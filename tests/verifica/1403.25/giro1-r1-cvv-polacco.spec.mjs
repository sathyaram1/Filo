// Verifica #1403.25 giro 1: il CVV annunciato dal «to» polacco senza «kod» davanti arriva intero al modello.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require(join(resolve(process.cwd()), 'src', 'shared', 'pavimento.js'));

test('r1 il CVV scritto in polacco col «to» si toglie anche senza «kod» davanti', () => {
  for (const [riga, v] of [['CVV to 123', '123'], ['Mój CVV to 123', '123'], ['Numer CVV to 456', '456'],
    ['CVV mojej karty to 789', '789']]) expect(P.oscura(riga), riga).not.toContain(v);
  expect(P.oscura('Send the CVV to 123 Main Street')).toBe('Send the CVV to 123 Main Street');
});
