// Verifica #591, giro 12 — il freno per dominio del giudizio anti-phishing tiene solo se il modello risponde bene.
// Una risposta che non si legge (o un errore del fornitore) non lascia ricordo: ogni sottodominio nuovo dello
// stesso dominio richiama il modello, cioè la porta dei sottodomini sempre nuovi che la segnalazione chiedeva di chiudere.
// Niente Electron: il giudice è quello vero, il modello dietro al cancello è finto.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const SB = require_(join(REPO, 'src/main/services/safebrowse/index.js'));

const LOGIN = { linkOrigin: 'email', hasPassword: true };

function pulisci() {
  for (const c of Object.values(SB._caches || {})) {
    if (c && c.m && typeof c.m.clear === 'function') c.m.clear();
    else if (c && typeof c.clear === 'function') c.clear();
  }
}

async function giro(dominio, runLlm) {
  pulisci();
  let chiamate = 0;
  SB.configure({
    runLlm: async (messages) => { chiamate++; return runLlm(messages); },
    enableSandbox: false,
    enableNetwork: false,
  });
  for (let i = 0; i < 20; i++) {
    await new Promise((ok) => {
      SB.analyze(`http://accesso${i}.${dominio}/login`, LOGIN, ok);
      setTimeout(ok, 150);
    });
  }
  return chiamate;
}

test('una risposta del modello che non si legge fa ripartire il giudizio a ogni sottodominio', async () => {
  const chiamate = await giro('dominio-prosa-giro12.com', async () => 'Non ho abbastanza elementi per giudicare questo sito.');
  expect(chiamate, 'venti sottodomini dello stesso dominio, ognuno una chiamata pagata').toBeLessThanOrEqual(2);
});

test('un errore del fornitore fa ripartire il giudizio a ogni sottodominio', async () => {
  const chiamate = await giro('dominio-errore-giro12.com', async () => { const e = new Error('Too Many Requests'); e.status = 429; throw e; });
  expect(chiamate, 'venti sottodomini dello stesso dominio, ognuno una richiesta al fornitore').toBeLessThanOrEqual(2);
});

test('caso di riscontro: con una risposta valida il giudizio parte una volta sola', async () => {
  const chiamate = await giro('dominio-valido-giro12.com', async () => '{"suspicious": false, "reason": null, "confidence": "low"}');
  expect(chiamate).toBe(1);
});
