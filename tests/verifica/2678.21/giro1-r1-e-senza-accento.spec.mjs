// Verifica #2678.21, giro 1: la «e» senza accento al posto di «è» ferma la password solo subito dopo il nome. Dopo un
// inciso (la combinazione della segnalazione), un avverbio o nel tempo composto la password arriva al modello in chiaro.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');

const FRASI = [
  'la password, che era vecchia, e Mela!Verde77',
  'la password, credo, e Mela!Verde77',
  'la password, se non sbaglio, e Mela!Verde77',
  'la password (quella nuova) e Mela!Verde77',
  'la password - te lo dico - e Mela!Verde77',
  'la pasword, che era vecchia, e Mela!Verde77',
  'la password ora e Mela!Verde77',
  'la password adesso e Mela!Verde77',
  'la password e stata cambiata in Mela!Verde77',
  'LA PASSWORD, CHE ERA VECCHIA, E MELA!VERDE77',
];

test('r1 la «e» senza accento dopo un inciso, un avverbio o nel tempo composto non lascia passare la password', () => {
  const fughe = FRASI.filter((t) => /mela/i.test(P.oscura(t)));
  expect(fughe).toEqual([]);
  for (const t of FRASI) expect(P.oscura(t)).toContain(P.SEGNAPOSTO);
});
