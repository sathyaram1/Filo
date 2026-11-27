// Verifica #2673.10, giro 1: la password scritta in un elemento Markdown sotto l'etichetta non arriva ai modelli.
// Il cancello dei modelli deve coprirla dove la copre già il correttore: stessa forma, stesso esito.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');
const C = require('../../../src/main/services/correttoreRiservati.js');

const CASI = {
  'blocco di codice dentro una citazione': 'Password:\n> ```\n> Nyckel!2024\n> ```',
  'etichetta e blocco di codice citati': '> Password:\n> ```\n> Nyckel!2024\n> ```',
  'voce di elenco dopo tre righe vuote': 'Password:\n\n\n\n- Nyckel!2024',
  'blocco di codice dopo due righe vuote': 'Password:\n\n\n```\nNyckel!2024\n```',
  'tabella con una cella vuota in mezzo': '| Password: | | Nyckel!2024 |',
  'tabella con una barra protetta nella password': '| Password: | Nyckel\\|2024 |',
};

for (const [nome, testo] of Object.entries(CASI)) {
  test(`r1 ${nome}: il correttore la copre e il cancello dei modelli anche`, () => {
    expect(C.oscura(testo)).not.toMatch(/Nyckel|2024/);
    expect(P.oscura(testo)).not.toMatch(/Nyckel|2024/);
  });
}
