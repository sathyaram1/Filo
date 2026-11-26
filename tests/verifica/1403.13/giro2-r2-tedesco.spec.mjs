// #1403.13 giro 2: in tedesco il codice annunciato da una frase più lunga fra il nome e il numero deve sparire,
// come «Le code que tu as reçu est 482913» in francese.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

test('r2 futuro, subordinata e scopo in tedesco tolgono il codice', () => {
  for (const frase of [
    'Dein Code wird 482913 sein',
    'Der Code, den du erhalten hast, ist 482913',
    'Der Code, den ich bekommen habe, lautet 482913',
    'Der Code zum Einloggen ist 482913',
  ]) {
    expect(P.oscura(frase), frase).not.toContain('482913');
  }
});
