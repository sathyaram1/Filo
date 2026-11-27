// Verifica #2678.21, giro 1: del verbo si tollera solo l'accento mancante; un tasto sbagliato nel verbo («si» per «is»,
// «diventta», «statta», «cambita») lascia arrivare la password al modello in chiaro.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');

const FRASI = [
  'the password si Mela!Verde77',
  'the password iz Mela!Verde77',
  'la password diventta Mela!Verde77',
  'la password rimae Mela!Verde77',
  'la password è statta cambiata in Mela!Verde77',
  'la password è stata cambita in Mela!Verde77',
  "la password è' Mela!Verde77",
  'la password e` Mela!Verde77',
];

test('r2 un refuso nel verbo non lascia passare la password', () => {
  const fughe = FRASI.filter((t) => P.oscura(t).includes('Mela'));
  expect(fughe).toEqual([]);
});
