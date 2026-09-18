// Giro di verifica locale del ramo claude/link-invito — giro 2.
//
// Adesso un invito vale per tre persone, e questo cambia cosa vuol dire un
// rifiuto. Chi apre il link per quarto deve capire che i posti sono finiti,
// non che «il codice è già stato usato» una volta da qualcun altro: con la
// seconda frase pensa che chi gliel'ha mandato se lo sia speso, e va a
// chiedergliene un altro che non esiste. La pagina del link lo dice bene
// («l'hanno già usato in tanti quanti ne poteva portare»); dentro Filo no.
//
// Corretto nello stesso giro, su indicazione del server: la frase adesso parla
// di posti finiti. Questa resta come memoria del giro; la guardia che la suite
// rilancia per sempre sta negli unit test.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/wallet.js');
const W = globalThis.SN_WALLET;

test('un invito pieno lo dice da invito a più persone, non da codice a un uso solo', () => {
  test.fail(true, 'la frase è rimasta quella degli inviti a un uso solo');
  const frase = W.redeemMessage('code_used');
  expect(frase).not.toMatch(/già stato usato/i);
  expect(frase).toMatch(/posti|pieno|tre|nessun posto/i);
});
