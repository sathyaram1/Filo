// #2678 giro 1: un valore fra virgolette finisce alla virgoletta che chiude, qualunque cosa venga dopo sulla riga
// e qualunque forma lo introduca (due punti, verbo, spazi dentro le virgolette).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

function nascosto(frase, valore) {
  const fuori = P.oscura(frase);
  expect(fuori, frase).toContain(P.SEGNAPOSTO);
  for (const parola of valore.split(/\s+/)) expect(fuori, `${frase} => ${fuori}`).not.toContain(parola);
}

test('r1 la frase-password fra virgolette seguita da altro testo sulla riga', () => {
  nascosto('Password: “casa mia al mare”, grazie', 'casa mia al mare');
  nascosto('Password: «casa mia al mare», grazie', 'casa mia al mare');
  nascosto('password: “casa mia al mare” (non dirla)', 'casa mia al mare');
});

test('r1 la frase-password fra virgolette dopo il verbo', () => {
  nascosto('la password è “casa mia al mare”', 'casa mia al mare');
  nascosto('la password è «casa mia al mare»', 'casa mia al mare');
});

test('r1 la password con gli spazi dentro le virgolette, coi due punti o col verbo', () => {
  nascosto('password: « Mela!Verde77 »', 'Mela!Verde77');
  nascosto('la password è « Mela!Verde77 »', 'Mela!Verde77');
});
