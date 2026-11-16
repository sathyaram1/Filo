// #2270 giro 1, rilievo 2: la riga di changelog di un pacchetto collega ogni assorbito nato da un utente solo se chi
// lavora il pacchetto sa di scriverla con l'elenco dei numeri: le istruzioni che legge devono dirlo.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const leggi = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('r2 chi lavora un pacchetto sa che la riga di changelog porta i numeri degli assorbiti', () => {
  const istruzioni = ['CLAUDE.md', 'routines/roles/resolver.md', 'routines/roles/_unite.md'].map(leggi).join('\n');
  expect(istruzioni).toMatch(/segnalazione: \[/);
});
