// Verifica #1723, giro 3: la password scritta a mano dopo l'etichetta corta «pass» (coi due punti, accanto al nome
// utente o dopo il nome della rete) o dopo «le credenziali sono» non arriva al modello del correttore.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

const alModello = (campo) => JSON.stringify(R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra: '' }));

for (const [campo, valore] of [
  ['Pass: Girasole2024', 'Girasole2024'],
  ['User: mario / Pass: Girasole2024', 'Girasole2024'],
  ['User: mario\nPass: Girasole2024', 'Girasole2024'],
  ['utente: mario pass: Girasole2024', 'Girasole2024'],
  ['user mario pass Girasole2024', 'Girasole2024'],
  ['Wi-Fi CasaRossi pass Faro7Blu55', 'Faro7Blu55'],
  ['Le credenziali sono: mario / Girasole2024', 'Girasole2024'],
  ['Le mie credenziali sono mario@gmail.com / Girasole2024', 'Girasole2024'],
]) {
  test(`r2 «${campo.replace(/\n/g, ' ⏎ ')}»: la password non parte`, () => {
    expect(alModello(campo)).not.toContain(valore);
  });
}
