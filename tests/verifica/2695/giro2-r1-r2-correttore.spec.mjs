// #2695 giro 2: una password detta accanto a una spiegazione non arriva al modello del correttore; una frase che spiega
// la password ci arriva intera.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0 }).nuovo;

test('r1 una password detta accanto a una spiegazione non arriva al modello del correttore', () => {
  for (const frase of [
    'la password del wifi è gattonero ma scade a giugno',
    'la password è gattonero va bene?',
    'la password wifi è gattonero non dirla a nessuno',
    'la password è gattonero prima di tutto',
    'la password è gattonero scade domani',
    'la password del wifi è sul retro gattonero',
    'la password è nel cassetto gattonero',
  ]) {
    expect(alCorrettore(frase), frase).not.toContain('gattonero');
  }
});

test('r2 una frase che spiega la password arriva intera al modello del correttore', () => {
  const rotte = [];
  for (const frase of [
    'la password ha una maiuscola',
    'cambia la password domani',
    'la password scade domani',
    'la password del conto è scritta sul foglio',
    'la password deve contenere un numero',
    'ho cambiato la password stamattina',
    'la password è salvata nel portachiavi',
    'usa una password diversa per ogni sito',
    'la password è temporanea',
    'la password è obbligatoria',
    'la password è richiesta',
    'la password serve per entrare',
    'la password resta segreta',
    'la password va inserita due volte',
    'la password si cambia dalle impostazioni',
  ]) {
    if (alCorrettore(frase) !== frase) rotte.push(`${frase} -> ${alCorrettore(frase)}`);
  }
  expect(rotte).toEqual([]);
  expect(alCorrettore('la password è gattonero')).not.toContain('gattonero');
});
