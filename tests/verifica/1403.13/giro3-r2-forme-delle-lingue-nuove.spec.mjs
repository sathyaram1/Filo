// #1403.13 giro 3: forme che in italiano, francese e spagnolo tolgono il codice e nelle altre lingue del lavoro no:
// l'articolo prima del numero in tedesco, il futuro e «eenmalige» in olandese, il numero in testa in polacco.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

test('r2 articolo, futuro e numero in testa tolgono il codice anche in tedesco, olandese e polacco', () => {
  for (const [frase, valore] of [
    ['Der Code ist der 482913', '482913'],
    ['Die PIN ist die 4829', '4829'],
    ['De code wordt 482913', '482913'],
    ['Je eenmalige code is 482913', '482913'],
    ['482913 to Twój kod weryfikacyjny', '482913'],
  ]) {
    expect(P.oscura(frase), frase).not.toContain(valore);
  }
});
