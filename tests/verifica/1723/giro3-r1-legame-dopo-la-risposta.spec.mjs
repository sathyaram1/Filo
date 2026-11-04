// Verifica #1723, giro 3: quando chi scrive ha già dato la password sopra il campo, in una frase o di sole lettere, il
// messaggio dopo arriva intero al modello del correttore: le sue parole normali non diventano un dato riservato.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const R = require('../../../src/main/services/correttoreRiservati.js');

const alModello = (sopra, campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0, sopra }).nuovo;
const CAMPO = 'alle venti davanti al cinema';

for (const risposta of [
  'è Gatto2024 con la G maiuscola',
  'certo, la password è Gatto2024 ma non dirla in giro',
  'Gatto2024 (con la G maiuscola)',
  'la password è gattonero',
  'eccola: gattonero',
  'è gattonero tutto minuscolo',
]) {
  test(`r1 sotto la risposta «${risposta}» il messaggio dopo parte intero`, () => {
    const sopra = `mi mandi la password del wifi?\n${risposta}\ngrazie! a che ora ci vediamo?`;
    expect(alModello(sopra, CAMPO)).toBe(CAMPO);
  });
}
