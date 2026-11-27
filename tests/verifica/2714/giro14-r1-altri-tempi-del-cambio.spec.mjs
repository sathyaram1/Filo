// #2714 giro 14: il cambio detto al presente, al futuro, all'infinito o al gerundio copre il valore nuovo verso il modello
// principale e lo dà come segreto in uscita, come fa già il correttore.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const G = globalThis.SN_GUARDIANO_STATICO;
const testo = (x) => (x && typeof x === 'object' ? x.testo : x);

const CASI = [
  ['voglio cambiare la password in Mela!Verde77', 'Mela!Verde77'],
  ['cambierò la password in Mela!Verde77', 'Mela!Verde77'],
  ['ho rinnovato la password con Mela!Verde77', 'Mela!Verde77'],
  ['cambio il pin in 4821', '4821'],
  ['il pin lo cambio in 4821', '4821'],
  ['cambierò il pin in 4821', '4821'],
  ['voglio cambiare il pin in 4821', '4821'],
  ['ho deciso di cambiare il pin in 4821', '4821'],
  ['sto cambiando il pin in 4821', '4821'],
  ['imposta il pin a 4821', '4821'],
  ['il pin da 1234 passa a 4821', '4821'],
];

test('r1 il valore nuovo non arriva al modello principale', () => {
  for (const [frase, valore] of CASI) expect(testo(P.oscura(frase)), frase).not.toContain(valore);
});

test('r1 il valore nuovo è un segreto in uscita verso i siti', () => {
  for (const [frase, valore] of CASI) expect(G.segretiInUscita(frase).map((x) => x.valore), frase).toContain(valore);
});
