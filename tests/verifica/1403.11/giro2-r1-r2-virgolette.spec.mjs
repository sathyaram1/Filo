// #1403.11 giro 2 — una password scritta dopo l'etichetta non arriva al modello, qualunque sia la grafia delle
// virgolette o del verbo che la introduce.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../../src/shared/pavimento.js');

test('r1 dopo l\'etichetta straniera il verbo nella forma «c\'est» e le etichette dei codici tolgono il valore', () => {
  for (const frase of [
    'Mon mot de passe c\'est « Mela!Verde77 »',
    'le mot de passe, c\'est « Mela!Verde77 »',
    'mon mot de passe c\'est Mela!Verde77',
    'Le code d\'accès est « 482913 »',
    'Der Zugangscode ist 482913',
    'el código de acceso es 482913',
  ]) {
    const o = P.oscura(frase);
    expect(o, frase).toContain(P.SEGNAPOSTO);
    expect(o, frase).not.toMatch(/Mela!Verde77|482913/);
  }
});

test('r2 una password fra virgolette interne, dentro virgolette con lo spazio, si toglie come senza spazi', () => {
  for (const frase of [
    'la password è « \'Mela!Verde77\' »',
    'Password: « \'Mela!Verde77\' »',
    'la password è “ “Mela!Verde77” ”',
    'la password è « "Mela!Verde77" »',
  ]) {
    expect(P.oscura(frase), frase).not.toContain('Mela!Verde77');
  }
});
