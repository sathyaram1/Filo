// Verifica #732 giro 2: un marchio-parola scritto con lettere finte e attaccato a un'altra parola avvisa ancora all'apertura.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { domainToASCII } from 'node:url';

const require = createRequire(import.meta.url);
const { evaluate } = require('../../../src/main/services/safebrowse/engine.js');

test('r2 lettere cirilliche dentro un marchio attaccato (аpplelogin, сhaselogin): l\'apertura avvisa', () => {
  for (const h of ['аpplelogin.com', 'сhaselogin.com', 'аpplelogin.github.io']) {
    const u = 'https://' + domainToASCII(h) + '/';
    expect(evaluate(u).level, h).not.toBe('safe');
  }
});

test('r2 una cifra al posto di una lettera in un marchio attaccato (app1elogin): l\'apertura avvisa', () => {
  expect(evaluate('https://app1elogin.com/').level).not.toBe('safe');
});
