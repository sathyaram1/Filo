// Verifica #2681, giro 1: il nome del CVV scritto con un errore di battitura («crytogramme», «cryptograme»).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const P = require(join(ROOT, 'src', 'shared', 'pavimento.js'));

for (const riga of ['Le crytogramme est 123', 'Le cryptograme est 123', 'El codigo de seguirdad es 123']) {
  test(`r2 il CVV non arriva al modello: ${riga}`, () => {
    expect(P.oscura(riga)).not.toContain('123');
  });
}
