// Verifica #2673.10, giro 4: la password sotto l'etichetta, con un segno Markdown di mezzo, non arriva ai modelli.
// r1: forme che main copre e il ramo lascia passare; r2: la riga di separazione coperta al posto della password.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');
const C = require('../../../src/main/services/correttoreRiservati.js');

const R1 = {
  'citazione con una riga citata vuota in mezzo': 'Password:\n>\n> Nyckel!2024',
  'etichetta in grassetto citata e riga citata vuota': '> **Password:**\n>\n> Nyckel!2024',
  'citazione con la riga vuota fatta di «> »': '> Password:\n> \n> Nyckel!2024',
  'PIN citato con una riga citata vuota': '> PIN:\n>\n> 4821',
  'password che comincia con tre tilde': 'Password:\n~~~Nyckel2024',
  'password che comincia con tre apici inversi': 'Password:\n```Nyckel2024',
};
for (const [nome, testo] of Object.entries(R1)) {
  test(`r1 ${nome}: né il cancello dei modelli né il correttore la lasciano passare`, () => {
    expect(P.oscura(testo)).not.toMatch(/Nyckel|4821/);
    expect(C.oscura(testo)).not.toMatch(/Nyckel|4821/);
  });
}

const R2 = {
  'linea orizzontale «---» fra etichetta e password': 'Password:\n---\nNyckel!2024',
  'linea orizzontale «___»': 'Password:\n___\nNyckel!2024',
  'linea orizzontale fra righe vuote, etichetta in grassetto': '**Password:**\n\n---\n\nNyckel!2024',
  'titolo sottolineato con «===»': 'Password\n========\nNyckel!2024',
  'voce di un elenco di definizioni': 'Password:\n: Nyckel!2024',
};
for (const [nome, testo] of Object.entries(R2)) {
  test(`r2 ${nome}: il cancello dei modelli copre la password`, () => {
    expect(P.oscura(testo)).not.toMatch(/Nyckel/);
  });
}
