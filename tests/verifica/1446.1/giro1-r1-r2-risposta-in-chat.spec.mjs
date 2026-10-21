// Verifica #1446.1, giro 1: la password data in chat a chi la chiede non parte verso il modello del correttore, anche
// quando la domanda non ha il punto interrogativo o usa un'abbreviazione; il resto della risposta resta controllabile.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

const partono = (sopra, campo) => JSON.stringify(R.richiestaSenzaRiservati({
  prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra, luogo: { conversazione: sopra }, contesto: { prima: sopra },
}));

for (const domanda of [
  'Marco: mi mandi la password del wifi',
  'Marco: mi dai la password del wifi',
  'Marco: mi scrivi la password del wifi',
  'Marco: me la mandi la password',
  'Marco: mi mandi la pw del wifi?',
  'Marco: mi dici la pass del wifi?',
  'Marco: mi dai la chiave del wifi?',
]) {
  test(`r1 «${domanda}» e la risposta «certo, Gatto2024»: la password non parte`, () => {
    expect(partono(domanda, 'certo, Gatto2024 ')).not.toContain('Gatto2024');
  });
}

test('r2 una risposta senza password resta controllabile: «ruoter» e «guardo» arrivano al modello', () => {
  const p = JSON.parse(partono('Marco: mi mandi la password del wifi?', 'aspetta che guardo sotto il ruoter'));
  expect(p.nuovo).toBe('aspetta che guardo sotto il ruoter');
});
