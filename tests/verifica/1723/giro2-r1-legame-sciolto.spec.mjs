// Verifica #1723, giro 2: la risposta resta legata a chi chiede la password anche se sotto la richiesta c'è una riga
// «Parola: …» (un altro del gruppo, un «PS:», un indirizzo): su main queste password non partivano.
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
  'Marco: mi mandi la password del wifi?\nLuca: anche a me serve!',
  'Marco: mi mandi la password del wifi?\nIndirizzo: via Roma 5',
  'mi mandi la password del wifi?\n18:01\nPS: porta il vino\n18:02',
  'mi mandi la password del wifi?\nOre 20: cena da me',
]) {
  test(`r1 sopra ${JSON.stringify(sopra)}, la risposta «Gatto2024» non parte`, () => {
    const p = partono(sopra, 'Gatto2024');
    expect(p).not.toContain('Gatto2024');
    expect(p).toContain(R.SEGNAPOSTO);
  });
}
