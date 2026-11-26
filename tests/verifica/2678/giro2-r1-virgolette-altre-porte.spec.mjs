// #2678 giro 2: la frase-password fra virgolette si toglie intera anche dove il valore non segue i due punti o il
// verbo sulla stessa riga: freccia o trattino, riga sotto l'etichetta, nome di campo, virgoletta che non chiude.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

function nascosto(frase, valore) {
  const fuori = P.oscura(frase);
  expect(fuori, frase).toContain(P.SEGNAPOSTO);
  for (const parola of valore.split(/\s+/)) expect(fuori, `${frase} => ${fuori}`).not.toContain(parola);
}

test('r1 la frase-password fra virgolette dopo una freccia o un trattino', () => {
  nascosto('Password → “casa mia al mare”', 'casa mia al mare');
  nascosto('Password - “casa mia al mare”', 'casa mia al mare');
});

test('r1 la frase-password fra virgolette sulla riga sotto l\'etichetta', () => {
  nascosto('Password\n“casa mia al mare”', 'casa mia al mare');
  nascosto('Password:\n«casa mia al mare»', 'casa mia al mare');
});

test('r1 la frase-password fra virgolette curve dopo un nome di campo', () => {
  nascosto('DB_PASSWORD: “casa mia al mare”', 'casa mia al mare');
  nascosto('password1: “casa mia al mare”', 'casa mia al mare');
});

test('r1 la frase-password con la virgoletta che apre e nessuna che chiude', () => {
  nascosto('Password: “casa mia al mare', 'casa mia al mare');
});
