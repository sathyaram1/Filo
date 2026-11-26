// #2678 giro 5: una frase-password fra virgolette che contiene altre virgolette (o un apostrofo curvo fra apici curvi)
// si toglie intera: la virgoletta interna non chiude la frase.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

function nascosto(frase, valore) {
  const fuori = P.oscura(frase);
  expect(fuori, frase).toContain(P.SEGNAPOSTO);
  for (const parola of valore.split(/\s+/).filter((p) => p.length >= 4)) expect(fuori, `${frase} => ${fuori}`).not.toContain(parola);
}

test('r1 la frase-password con altre virgolette dentro', () => {
  nascosto('Password: «il "gatto" nero»', 'il gatto nero');
  nascosto('Password: «il gatto "nero"»', 'il gatto nero');
  nascosto('Password: “dimmi «ciao» amico”', 'dimmi ciao amico');
  nascosto('Password: ‘l’amore è bello’', 'amore bello');
});
