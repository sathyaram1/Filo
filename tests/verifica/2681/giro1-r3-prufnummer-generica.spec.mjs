// Verifica #2681, giro 1: «Prüfnummer», «Prüfcode», «Prüfziffer» senza la carta sono numeri di controllo qualunque
// (una perizia, un prodotto, un rapporto): il numero deve arrivare al modello.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const P = require(join(ROOT, 'src', 'shared', 'pavimento.js'));

for (const riga of ['Die Prüfnummer des Gutachtens ist 2024', 'Der Prüfcode des Produkts ist 456',
  'Prüfziffer 1234 im Bericht', 'Prüfnummer 123 des TÜV']) {
  test(`r3 la frase resta intera: ${riga}`, () => {
    expect(P.oscura(riga)).toBe(riga);
  });
}
