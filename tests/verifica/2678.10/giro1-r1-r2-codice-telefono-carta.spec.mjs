// #2678.10 giro 1: il codice che sblocca il telefono o la carta, detto «codice», non deve arrivare ai modelli in nessuna
// delle forme in cui lo stesso pavimento già toglie quello del cellulare o della carta.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const P = require(join(ROOT, 'src', 'shared', 'pavimento.js'));

const togli = (frase) => expect(P.oscura(frase), frase).not.toContain('4821');

test('r1 il telefono come il cellulare: con chi lo possiede, un aggettivo, l\'articolo, le maiuscole', () => {
  for (const f of [
    'il codice del cellulare di mia madre è 4821',
    'il cellulare ha il codice 4821',
    'il codice del cellulare è il 4821',
  ]) togli(f);
  for (const f of [
    'il codice del telefono di mia madre è 4821',
    'il codice del telefono di Marco è 4821',
    'il codice del telefono di lavoro è 4821',
    'il codice del telefono aziendale è 4821',
    'il codice del telefono nuovo è 4821',
    'il telefono ha il codice 4821',
    'il codice del telefono è il 4821',
    'il codice del telefono è: 4821',
    'il codice del telefono È 4821',
    'IL CODICE DEL TELEFONO È 4821',
  ]) togli(f);
});

test('r2 i nomi comuni del telefono e della carta', () => {
  for (const f of [
    'il codice del cell è 4821',
    'il codice della postepay è 4821',
    'il codice della prepagata è 4821',
    'il codice della mastercard è 4821',
    'il codice della revolut è 4821',
  ]) togli(f);
});
