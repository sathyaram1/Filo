// #2695 giro 3: una frase o una cella che descrive la password arriva intera ai modelli; la password vera resta fuori.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0 }).nuovo;

test('r1 una frase che spiega la password arriva intera al modello del correttore', () => {
  const rotte = [];
  for (const frase of [
    'la password è complessa',
    'la password è troppo semplice',
    'la password è facile da indovinare',
    'la password è lunga dodici caratteri',
    'la password della banca è complicata',
    'la password è cifrata',
    'la password è robusta',
    'la password è giusta',
    'la password è necessaria',
    'la password è in cucina',
    'la password è nel foglio Excel',
    'la password è memorizzata nel browser',
    'la password è condivisa con tutta la famiglia',
    'la password del wifi la sa Marco',
    'la password del wifi ce l\'ha Giulia',
    'la password la gestisce l\'amministratore',
    'la password ti arriva per email',
    'la password si resetta dal sito',
    'cambiate la password entro lunedì',
    'password dimenticata? clicca qui',
    'the password is in the drawer',
  ]) {
    const arriva = alCorrettore(frase);
    if (arriva !== frase) rotte.push(`${frase} -> ${arriva}`);
  }
  expect(rotte).toEqual([]);
  expect(alCorrettore('la password è gattonero')).not.toContain('gattonero');
  expect(alCorrettore('la password del wifi è gattonero ma scade a giugno')).not.toContain('gattonero');
});

test('r2 una cella di una parola che descrive la password arriva intera ai modelli, come su main', () => {
  const rotte = [];
  for (const riga of [
    '| Password: | Scaduta |',
    '| Password: | Temporanea |',
    '| Password: | Predefinita |',
    '| Password: | Impostata |',
    '| Password: | Generata automaticamente |',
    '| Password: | N/A |',
  ]) {
    const arriva = P.oscura(riga);
    if (arriva !== riga) rotte.push(`${riga} -> ${arriva}`);
  }
  expect(rotte).toEqual([]);
  expect(P.oscura('| Password: | Nyckel!2024 |')).not.toContain('Nyckel!2024');
});
