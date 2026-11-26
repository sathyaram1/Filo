// Verifica #2681, giro 1: il CVV annunciato nelle lingue delle etichette con un nome o un verbo comuni che il
// riconoscimento non conosce ancora («Kod CVV to 123», «código de verificación», «Kartenpruefnummer»).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const P = require(join(ROOT, 'src', 'shared', 'pavimento.js'));

for (const riga of [
  'Kod CVV to 123', 'Mój CVV to 123', 'Kod CVC2 to 123',
  'El código de verificación es 123', 'El código de verificación de la tarjeta: 123',
  'O código de verificação é 123', 'Le code de vérification de la carte est 123',
  'Kartenpruefnummer: 123',
]) {
  test(`r1 il CVV non arriva al modello: ${riga}`, () => {
    expect(P.oscura(riga)).not.toContain('123');
  });
}
