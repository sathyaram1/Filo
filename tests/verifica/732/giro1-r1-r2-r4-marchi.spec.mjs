// Verifica #732 giro 1: siti ufficiali dei marchi su github.io, parole comuni col marchio dentro, tasto destro coerente.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate } = require('../../../src/main/services/safebrowse/engine.js');
require('../../../src/shared/linkSospetto.js');
const L = globalThis.SN_LINK_SOSPETTO;

test('r1 i siti ufficiali di Google su GitHub Pages più visitati non mostrano «Google? Controlla l\'indirizzo»', () => {
  for (const u of ['https://google-gemini.github.io/gemini-cli/', 'https://googleprojectzero.github.io/0days-in-the-wild/', 'https://google-ai-edge.github.io/']) {
    expect(evaluate(u).level, u).toBe('safe');
    expect(L.analizza(u), u).toEqual([]);
  }
});

test('r2 una parola comune che contiene Amazon (amazonia) non fa scattare il marchio', () => {
  for (const u of ['https://amazonia.github.io/', 'https://amazonia.org/']) {
    expect(evaluate(u).level, u).toBe('safe');
    expect(L.analizza(u), u).toEqual([]);
  }
});

test('r4 un link che il controllo all\'apertura segnala come sosia di un marchio avvisa anche dal tasto destro', () => {
  for (const u of ['https://chase-login.com/', 'https://wise-transfer.com/']) {
    expect(evaluate(u).level, u).not.toBe('safe');
    expect(L.analizza(u).some((c) => c.startsWith('nome_altrui:')), u).toBe(true);
  }
});
