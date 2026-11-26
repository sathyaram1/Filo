// #2695 giro 1 — una cella con l'etichetta coi due punti nasconde il valore della cella dopo per ogni etichetta che i
// cancelli conoscono fuori dalla tabella; una frase che spiega la password arriva intera al modello del correttore.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0 }).nuovo;

test('r1 nella riga di tabella il CVV e login_password dopo l\'etichetta coi due punti non arrivano ai modelli', () => {
  for (const [riga, valore] of [
    ['| CVV: | 123 |', '123'],
    ['| Codice CVV: | 123 |', '123'],
    ['| CVV: | 1234 |', '1234'],
    ['| login_password: | Nyckel!2024 |', 'Nyckel!2024'],
  ]) {
    expect(P.oscura(riga), `pavimento: ${riga}`).not.toContain(valore);
    expect(alCorrettore(riga), `correttore: ${riga}`).not.toContain(valore);
  }
});

test('r2 una frase che spiega la password arriva intera al modello del correttore', () => {
  for (const frase of [
    'la password scade tra 30 giorni',
    'la password è scaduta',
    'la password è sbagliata',
    'la password non funziona più',
    'la password va rinnovata ogni anno',
    'la password non va mai detta a nessuno',
    'la password del wifi è sul retro del router',
  ]) {
    expect(alCorrettore(frase), frase).toBe(frase);
  }
  // Il valore detto resta fuori, come prima.
  expect(alCorrettore('la password è gattonero')).not.toContain('gattonero');
});
