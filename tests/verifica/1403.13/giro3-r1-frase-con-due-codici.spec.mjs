// #1403.13 giro 3: in una frase con un codice di accesso e un identificativo, il primo sparisce e il secondo resta,
// qualunque dei due venga prima.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

test('r1 il codice di accesso sparisce e il numero del pacco o del cliente resta, nella stessa frase', () => {
  for (const [frase, via, resta] of [
    ['Le code de suivi est 777666 mais votre code de connexion est 482913', '482913', '777666'],
    ['El código de seguimiento es 777666 pero tu código de acceso es 482913', '482913', '777666'],
    ['Der Code der Bestellung ist 777666, aber dein Zugangscode ist 482913', '482913', '777666'],
    ['Votre code est 482913 et le code de suivi est 777666', '482913', '777666'],
    ['Tu código es 482913 y el código de seguimiento es 777666', '482913', '777666'],
    ['Dein Code ist 482913 und der Code der Bestellung ist 777666', '482913', '777666'],
    ['Le code client est 777666 et le code secret est 4829', '4829', '777666'],
    ['El código de cliente es 777666 y el PIN es 4829', '4829', '777666'],
  ]) {
    const fuori = P.oscura(frase);
    expect(fuori, frase).not.toContain(via);
    expect(fuori, frase).toContain(resta);
  }
});
