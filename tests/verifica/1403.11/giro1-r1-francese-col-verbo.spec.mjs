// #1403.11 giro 1: la frase d'esempio della segnalazione, in francese col verbo, deve perdere la password.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

const FRASI = [
  'le mot de passe est « Mela!Verde77 »',
  'Votre mot de passe est « Mela!Verde77 ».',
  'Das Passwort ist « Mela!Verde77 »',
  'la contraseña es « Mela!Verde77 »',
  'a senha é « Mela!Verde77 »',
];

for (const frase of FRASI) {
  test(`r1 la password non resta in: ${frase}`, () => {
    const fuori = P.oscura(frase);
    expect(fuori).not.toContain('Mela!Verde77');
    expect(fuori).toContain(P.SEGNAPOSTO);
  });
}
