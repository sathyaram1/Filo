// #2695 giro 1 — una frase che spiega la password arriva intera al modello del correttore, non solo l'esempio della
// segnalazione; il valore detto resta fuori.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0 }).nuovo;

test('r1 una frase che spiega la password arriva intera al modello del correttore', () => {
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
  expect(alCorrettore('la password è gattonero')).not.toContain('gattonero');
});
