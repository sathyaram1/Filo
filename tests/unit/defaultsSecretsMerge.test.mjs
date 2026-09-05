// Unit test per src/main/services/defaultsStore.js — il salvataggio delle chiavi
// API admin DEVE fondere (merge) la mappa `apiKeys` su Firestore, non sostituirla.
//
// Regressione reale (feedback alpha): dopo aver inserito SOLO la chiave Tavily
// (AI Studio) e salvato, la chiave OpenRouter già configurata risultava «non
// configurata». Causa: la PATCH usava `updateMask.fieldPaths=apiKeys`, che
// SOSTITUISCE l'intera mappa col solo `{ tavily }`, cancellando `openrouter`.
// Il fix usa maschere per-leaf (`apiKeys.tavily`, …) così Firestore fonde.
//
// Il test stuba `global.fetch` per catturare la PATCH al doc dei segreti e
// asserisce: (1) la maschera punta a `apiKeys.tavily` e NON a `apiKeys`; (2) il
// corpo contiene solo la chiave tavily sotto `apiKeys`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const Defaults = require(
  join(__dirname, '..', '..', 'src', 'main', 'services', 'defaultsStore.js'),
);

test('salvando solo la chiave Tavily la maschera è per-leaf (merge, non replace)', async () => {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    // PATCH (scrittura) e GET (refresh successivo) rispondono ok con doc vuoto.
    return {
      ok: true,
      status: 200,
      async json() { return { fields: {} }; },
      async text() { return ''; },
    };
  };
  try {
    await Defaults.update({ apiKeys: { tavily: 'tvly-test' } }, 'fake-id-token');
  } finally {
    global.fetch = realFetch;
  }

  // Trova la PATCH al doc config/secrets.
  const patch = calls.find((c) => (c.opts.method || '').toUpperCase() === 'PATCH'
    && c.url.includes('config/secrets'));
  assert.ok(patch, 'manca la PATCH al doc config/secrets');

  // (1) La maschera deve essere per-leaf, non il map intero.
  assert.match(patch.url, /updateMask\.fieldPaths=apiKeys\.tavily/,
    'la maschera deve toccare apiKeys.tavily (merge)');
  assert.doesNotMatch(patch.url, /updateMask\.fieldPaths=apiKeys(&|$)/,
    'la maschera NON deve essere il map intero apiKeys (replace cancella le altre chiavi)');

  // (2) Il corpo contiene solo tavily sotto apiKeys (openrouter/tavily intatte
  //     perché non toccate dalla maschera).
  const body = JSON.parse(patch.opts.body);
  const akFields = body?.fields?.apiKeys?.mapValue?.fields || {};
  assert.deepEqual(Object.keys(akFields), ['tavily']);
  assert.equal(akFields.tavily.stringValue, 'tvly-test');
});

test('salvando due chiavi la maschera ha entrambi i leaf, non il map', async () => {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return { ok: true, status: 200, async json() { return { fields: {} }; }, async text() { return ''; } };
  };
  try {
    await Defaults.update({ apiKeys: { tavily: 'g', openrouter: 'o' } }, 'tok');
  } finally {
    global.fetch = realFetch;
  }
  const patch = calls.find((c) => (c.opts.method || '').toUpperCase() === 'PATCH'
    && c.url.includes('config/secrets'));
  assert.ok(patch);
  assert.match(patch.url, /updateMask\.fieldPaths=apiKeys\.tavily/);
  assert.match(patch.url, /updateMask\.fieldPaths=apiKeys\.openrouter/);
  assert.doesNotMatch(patch.url, /updateMask\.fieldPaths=apiKeys(&|$)/);
});
