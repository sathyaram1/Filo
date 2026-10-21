// Verifica #1446.1, giro 2: la password data in chat a chi la chiede non parte verso il modello del correttore anche
// quando la richiesta ha forme comuni non previste, un errore di battitura, o un sollecito («??», «ci sei?») dopo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

const partono = (sopra, campo) => JSON.stringify(R.richiestaSenzaRiservati({
  prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra, luogo: { conversazione: sopra }, contesto: { prima: sopra },
}));

for (const sopra of [
  'Marco: che password ha il wifi',
  'Marco: ti ricordi la password del wifi',
  'Marco: e la password del wifi',
  'Marco: sono arrivato, password del wifi',
  'Marco: come è la password del wifi',
  'Marco: mi mandi la pasword del wifi?',
  'Marco: mi mandi la passowrd del wifi',
  'Marco: mi mandi la password del wifi?\nMarco: ci sei?',
  'Marco: mi mandi la password del wifi\nMarco: ??',
  'Marco: mi mandi la password del wifi? E a che ora ci vediamo?',
]) {
  test(`r1 sopra «${sopra.replace(/\n/g, ' / ')}», risposta «certo, Gatto2024»: la password non parte`, () => {
    expect(partono(sopra, 'certo, Gatto2024 ')).not.toContain('Gatto2024');
  });
}
