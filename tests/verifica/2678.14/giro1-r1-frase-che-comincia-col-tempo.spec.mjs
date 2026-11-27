// Verifica #2678.14, giro 1: frasi-password col numero e la parola di tempo in testa restano in chiaro, e descrizioni
// dello stato della password con un verbo fuori elenco spariscono. Logica pura, senza aprire Filo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require(resolve(process.cwd(), 'src/shared/pavimento.js'));

test('r1 una frase-password che comincia col numero e la parola di tempo non arriva al modello', () => {
  for (const [riga, frase] of [
    ['Password: tre anni al mare con mia madre', 'al mare con mia madre'],
    ['Password: due giorni a Parigi con Luca', 'a Parigi con Luca'],
    ['Password: dieci anni di matrimonio felice', 'matrimonio felice'],
    ['Password: da tre anni vivo a Milano', 'vivo a Milano'],
    ['Password: tra due giorni parto per Roma', 'parto per Roma'],
    ['Password: sette giorni in barca', 'in barca'],
    ['Password: three days in Paris', 'in Paris'],
  ]) expect(P.oscura(riga), riga).not.toContain(frase);
});

test('r1 la riga che dice lo stato della password resta leggibile', () => {
  for (const riga of [
    'Password: bloccata per 30 minuti',
    'Password: reimpostata 2 ore fa',
    'Password: la devo cambiare tra due giorni',
    'Password: me la chiede ogni 3 giorni',
    'Password: te la dico tra due giorni',
    'Password: minimum 8 characters',
    'Password: creata 2 mesi fa',
    'Password: reset 2 days ago',
  ]) expect(P.oscura(riga), riga).toBe(riga);
});
