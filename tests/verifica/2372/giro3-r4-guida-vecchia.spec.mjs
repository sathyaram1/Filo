// #2372 giro 3, rilievo 4: quello che Filo sa di sé descrive ancora la ricerca come «il campo in cima» della home, che
// non c'è più: chiesto come ritrovare una pagina chiusa o un messaggio, manda l'utente a cercare un campo che non trova.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const testi = ['src/shared/capabilities.js', 'src/shared/actionLevels.js'].map((f) => [f, readFileSync(f, 'utf8')]);

test('r4 Filo non indica più il campo di ricerca in cima alla home', () => {
  const vecchi = [];
  for (const [f, t] of testi) {
    for (const riga of t.split('\n')) {
      if (/«Cerca nel filo» in cima|cerca dal campo in cima/i.test(riga)) vecchi.push(`${f}: ${riga.trim().slice(0, 90)}`);
    }
  }
  expect(vecchi).toEqual([]);
});
