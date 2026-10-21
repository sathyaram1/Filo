// Verifica #1446.1, giro 2: la password data in risposta a chi la chiede non parte anche se arriva dopo una dozzina di
// parole della risposta.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

test('r2 la password dopo la tredicesima parola della risposta non parte', () => {
  const sopra = 'Marco: mi mandi la password del wifi?';
  const campo = 'certo aspetta che vado a vedere sul router perché non me la ricordo mai, è Gatto2024';
  const p = R.richiestaSenzaRiservati({
    prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra, luogo: { conversazione: sopra }, contesto: { prima: sopra },
  });
  expect(JSON.stringify(p)).not.toContain('Gatto2024');
});
