// #1589.8 — una ricerca con una password, una carta, un codice usa e getta o una chiave non parte verso il servizio di
// ricerca, chiunque la chieda (la chat e l'Aiuto passano da webSearch.search): Filo dice perché, e la rete non la vede.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../src/shared/pavimento.js');
require('../../src/main/services/webSearch.js');
const WS = globalThis.SN_WEB_SEARCH;

function reteFinta() {
  const chiamate = [];
  globalThis.fetch = async (url, opts = {}) => {
    chiamate.push({ url: String(url), body: String(opts.body || '') });
    return { ok: true, status: 200, json: async () => ({ results: [{ title: 'Risultato', url: 'https://esempio.it', content: 'testo' }] }), text: async () => '' };
  };
  return chiamate;
}

test('una ricerca qualunque arriva al servizio di ricerca coi risultati', async () => {
  const rete = reteFinta();
  for (const da of ['chat', 'aiuto']) {
    const r = await WS.search({ query: 'orari del museo egizio', tavilyKey: 'k', da });
    assert.equal(r.ok, true, da);
    assert.equal(r.results.length, 1, da);
  }
  assert.equal(rete.length, 2);
  assert.ok(rete.every((c) => c.body.includes('orari del museo egizio')));
});

test('una ricerca con un dato riservato non parte, da nessuna strada, e dice perché', async () => {
  const rete = reteFinta();
  const segreti = [
    'la password del portale è Tr7#kq29Lm come la cambio',
    'carta 4111 1111 1111 1111 è valida?',
    'codice di verifica 482913 non arriva',
    'Marco: mi mandi la password del wifi?\nIo: certo, Brezza7Mare',
  ];
  for (const query of segreti) {
    for (const da of ['chat', 'aiuto']) {
      const r = await WS.search({ query, tavilyKey: 'k', da });
      assert.equal(r.ok, false, query);
      assert.equal(r.pavimento, true, query);
      assert.match(r.reason, /dato riservato/, query);
    }
    assert.match(WS.riservata(query), /dato riservato/, `anche la ricerca di immagini: ${query}`);
  }
  assert.equal(rete.length, 0, 'il servizio di ricerca non ha visto niente');
});
