// #2678.13 giro 1 — la frase-password seguita da una nota o da un'emoji si toglie anche quando la riga non finisce lì:
// un punto, un saluto, un'altra frase dopo la nota, o la nota fra quadre o attaccata.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require('../../../src/shared/pavimento.js');

test('r1 dopo la nota o l\'emoji la riga continua: la frase-password non arriva al modello', () => {
  for (const [riga, valore] of [
    ['Password: casa mia al mare (tutto minuscolo).', 'casa mia al mare'],
    ['Password: casa mia al mare (tutto minuscolo)!', 'casa mia al mare'],
    ['Password: casa mia al mare (tutto minuscolo), utente mario', 'casa mia al mare'],
    ['Password: casa mia al mare (tutto minuscolo). Utente: mario', 'casa mia al mare'],
    ['Password: casa mia al mare 😊.', 'casa mia al mare'],
    ['Password: casa mia al mare 😊 grazie', 'casa mia al mare'],
    ['Password: casa mia al mare (tutto minuscolo) 😊 a presto', 'casa mia al mare'],
    ['Password: tramonto 😊.', 'tramonto'],
  ]) expect(P.oscura(riga), riga).not.toContain(valore);
});

test('r1 la nota fra quadre o attaccata alla frase vale quella fra parentesi', () => {
  for (const [riga, valore] of [
    ['Password: casa mia al mare [tutto minuscolo]', 'casa mia al mare'],
    ['Password: casa mia al mare(tutto minuscolo)', 'casa mia al mare'],
    ['Password: tramonto [minuscolo]', 'tramonto'],
  ]) expect(P.oscura(riga), riga).not.toContain(valore);
});

test('r1 la frase che non è una password resta', () => {
  for (const riga of ['Password: la trovi nel cassetto (quello in alto).', 'Password: dimenticata 😅.']) {
    expect(P.oscura(riga)).toBe(riga);
  }
});
