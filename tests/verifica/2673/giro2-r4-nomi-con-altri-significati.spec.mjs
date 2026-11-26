// Verifica #2673 giro 2 — tre nomi aggiunti hanno anche un significato comune: il codice di un prodotto in greco, il
// motto in ceco, il cifrario in turco. Quei dati arrivano ai modelli come prima. Logica pura, senza Electron.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');

test('r4 il codice prodotto di un negozio greco e il resto della riga restano', () => {
  const riga = 'Τιμή 12€ Κωδικός: 220145 Διαθεσιμότητα: Άμεσα';
  expect(P.oscura(riga)).toBe(riga);
});

test('r4 il motto ceco e il cifrario turco restano', () => {
  for (const riga of ['Heslo dne: Carpe diem', 'Volební heslo: Ano2024', 'şifre çözücü: Enigma1']) expect(P.oscura(riga)).toBe(riga);
});
