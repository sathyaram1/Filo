// Verifica #2673 giro 2 — il nome della password con un suffisso attaccato o dentro una parola composta: l'indonesiano
// «kata sandinya», lo svedese «wifilösenord». Logica pura, senza Electron.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

test('r3 le etichette col suffisso o composte coprono il valore', () => {
  const righe = ['Kata sandinya: Nyckel!2024', 'kata sandiku: Nyckel!2024', 'kata sandimu: Nyckel!2024', 'wifilösenord: Nyckel!2024',
    'routerlösenord: Nyckel!2024', 'nettverkspassord: Nyckel!2024', 'wifipassord: Nyckel!2024', 'wifisalasana: Nyckel!2024', 'wifiheslo: Nyckel!2024',
    'wifijelszó: Nyckel!2024', 'jelszavunk: Nyckel!2024', 'parolele: Nyckel!2024'];
  expect(righe.filter((r) => P.oscura(r).includes('Nyckel!2024'))).toEqual([]);
});

test('r3 in chat «apa kata sandinya» è una richiesta della password', () => {
  for (const f of ['apa kata sandinya', 'kata sandinya apa?', 'kirim kata sandinya dong']) {
    const campo = 'gattonero';
    expect(R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra: `Marco: ${f}` }).nuovo, f).not.toContain('gattonero');
    expect(P.oscura(`Marco: ${f}\nLuca: Gatto2024`), f).not.toContain('Gatto2024');
  }
});
