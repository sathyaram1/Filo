// Verifica #2673 giro 2 — «la password è …» detto nelle lingue aggiunte non arriva ai modelli, come in italiano e in
// inglese. Logica pura, senza Electron.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');

test('r2 la password presentata col verbo «essere» nella lingua di chi scrive non arriva ai modelli', () => {
  expect(P.oscura('la password è Nyckel2024')).not.toContain('Nyckel2024');
  const frasi = [
    'пароль это Nyckel2024', '密码是Nyckel2024', 'wifi密码是Nyckel2024', 'Ο κωδικός είναι Nyckel2024', 'Ο κωδικός πρόσβασης είναι Nyckel2024',
    'lösenordet är Nyckel2024', 'passordet er Nyckel2024', 'adgangskoden er Nyckel2024', 'salasana on Nyckel2024', 'heslo je Nyckel2024',
    'lozinka je Nyckel2024', 'parola este Nyckel2024', 'mật khẩu là Nyckel2024', 'kata sandi adalah Nyckel2024',
  ];
  expect(frasi.filter((f) => P.oscura(f).includes('Nyckel2024'))).toEqual([]);
});
