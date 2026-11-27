// Verifica #2692.4, giro 1: il PIN scritto a cifre separate non arriva al modello in nessuna delle forme comuni di
// separazione (a coppie, trattini con spazi, spazio unificatore, barre e virgole), né dal pavimento né dal correttore.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

const cifre = (t) => t.replace(/[^\p{N}]/gu, '');
const resta = (fuori, pin) => cifre(fuori).includes(pin);

// Il terzo campo: la forma che il correttore già toglie, provata solo sul pavimento.
for (const [testo, pin, soloPavimento] of [
  ['Il pin della carta è 48 21', '4821'],
  ['PIN: 48-21', '4821', true],
  ['PIN: 4 - 8 - 2 - 1', '4821'],
  ['Il pin è 4  8  2  1', '4821'],
  ['il pin è 4 8 2 1', '4821'],
  ['il pin è 4—8—2—1', '4821', true],
  ['il pin è 4−8−2−1', '4821', true],
]) {
  test(`r1 pavimento: «${testo}» non lascia il PIN`, () => {
    expect(resta(P.oscura(testo), pin), P.oscura(testo)).toBe(false);
  });
  if (!soloPavimento) test(`r1 correttore: «${testo}» non lascia il PIN`, () => {
    expect(resta(R.oscura(testo), pin), R.oscura(testo)).toBe(false);
  });
}

test('r1 correttore: «48 21» dato nel campo a chi chiede il PIN non parte', () => {
  const p = R.richiestaSenzaRiservati({ prima: '', nuovo: '48 21', dopo: '', sopra: 'Marco: qual è il pin della carta?' });
  expect(cifre(JSON.stringify(p))).not.toContain('4821');
  expect(p.nuovo).not.toContain('48');
});
