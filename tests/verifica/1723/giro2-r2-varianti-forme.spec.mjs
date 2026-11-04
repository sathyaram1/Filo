// Verifica #1723, giro 2: le forme libere della segnalazione (nome utente / password, rete - chiave) tolgono la password
// anche nelle loro varianti comuni, non solo con l'etichetta esatta degli esempi.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

const partono = (campo) => JSON.stringify(R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra: '' }));

for (const [campo, valore] of [
  ['Login: mario / Girasole2024', 'Girasole2024'],
  ['Account: mario / Girasole2024', 'Girasole2024'],
  ['Credenziali: mario - Girasole2024', 'Girasole2024'],
  ['WiFi CasaRossi - Faro7Blu55', 'Faro7Blu55'],
  ['Rete: CasaRossi - Faro7Blu55', 'Faro7Blu55'],
  ['Wi-Fi: CasaRossi, Faro7Blu55', 'Faro7Blu55'],
]) {
  test(`r2 «${campo}»: ${valore} non parte`, () => {
    expect(partono(campo)).not.toContain(valore);
  });
}
