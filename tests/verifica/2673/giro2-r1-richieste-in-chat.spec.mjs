// Verifica #2673 giro 2 — chi chiede la password in chat nelle lingue aggiunte: la risposta sotto non arriva ai modelli,
// come con «qual è la password» in italiano. Logica pura, senza Electron.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

const risposta = (sopra, campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra }).nuovo;

const RICHIESTE = [
  'mi a jelszó', 'mi a wifi jelszava', 'el tudod küldeni a jelszót', 'megvan a jelszó',
  'jaké je heslo', 'jaké je heslo na wifi', 'můžeš mi poslat heslo', 'máš heslo',
  'aké je heslo na wifi', 'môžeš mi poslať heslo',
  'voitko lähettää salasanan', 'wifin salasana', 'onko sinulla salasana',
  'har du lösenordet', 'påminn mig om lösenordet', 'har du passordet', 'har du adgangskoden',
  'možeš li mi poslati lozinku', 'imaš li lozinku', 'ai parola', 'parola de la wifi', 'bạn có mật khẩu không', 'şifre neydi',
  'wifi密碼是什麼', 'ο κωδικός πρόσβασης του wifi', 'ما هي كلمة السر', 'מה הסיסמה', 'वाईफाई का पासवर्ड क्या है',
];

test('r1 la risposta di sole lettere a chi chiede la password non parte verso il correttore', () => {
  const fuori = RICHIESTE.filter((f) => risposta(`Marco: ${f}`, 'gattonero').includes('gattonero'));
  expect(fuori).toEqual([]);
});

test('r1 la risposta con le cifre, sotto la richiesta, non arriva ai modelli', () => {
  const fuori = RICHIESTE.filter((f) => P.oscura(`Marco: ${f}\nLuca: Gatto2024`).includes('Gatto2024'));
  expect(fuori).toEqual([]);
});
