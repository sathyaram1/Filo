// #2678 giro 4: una frase-password fra virgolette si toglie intera anche quando comincia con un articolo, una
// preposizione o «non», quando ha più di dieci parole e quando supera i 64 caratteri.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

function nascosto(frase, valore) {
  const fuori = P.oscura(frase);
  expect(fuori, frase).toContain(P.SEGNAPOSTO);
  for (const parola of valore.split(/\s+/).filter((p) => p.length >= 4)) expect(fuori, `${frase} => ${fuori}`).not.toContain(parola);
}

test('r1 la frase-password fra virgolette che comincia con una parola comune', () => {
  nascosto('Password: “la casa al mare”', 'la casa al mare');
  nascosto('Password: “il mio cane Fido”', 'il mio cane Fido');
  nascosto('Password: "non ti scordar di me"', 'non ti scordar di me');
  nascosto('password: «con te partirò», ciao', 'con te partirò');
  nascosto('Password: “the quick brown fox”', 'the quick brown fox');
  nascosto('Password: «la casa al mare 77!»', 'la casa al mare 77!');
  nascosto('la password è «in bocca al lupo»', 'in bocca al lupo');
});

test('r1 la frase-password fra virgolette lunga', () => {
  nascosto('Password: “casa mia al mare sole vento pane luna fiume rosso verde”', 'casa mia al mare sole vento pane luna fiume rosso verde');
  nascosto('Password: “precipitevolissimevolmente straordinariamente indubitabilmente bellissime”', 'precipitevolissimevolmente straordinariamente indubitabilmente bellissime');
});
