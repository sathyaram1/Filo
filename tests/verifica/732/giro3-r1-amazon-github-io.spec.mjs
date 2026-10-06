// Verifica #732 giro 3: su amazon.github.io l'apertura e il tasto destro sul link devono dare la stessa risposta.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate } = require('../../../src/main/services/safebrowse/engine.js');
require('../../../src/shared/linkSospetto.js');
const L = globalThis.SN_LINK_SOSPETTO;

test('r1 amazon.github.io: l\'apertura avvisa se e solo se avvisa il tasto destro', () => {
  const u = 'https://amazon.github.io/';
  const apertura = evaluate(u).level !== 'safe';
  const tastoDestro = L.analizza(u).some((c) => /^(nome_altrui|typosquatting|omografo):/.test(c));
  expect(tastoDestro).toBe(apertura);
});
