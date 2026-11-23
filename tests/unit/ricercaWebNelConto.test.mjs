// #591.6 — la ricerca sul web di Filo (Tavily) si paga come un modello: entra nel conto del mese e col limite
// raggiunto non parte, da qualunque strada arrivi (chat, Aiuto, correttore, immagini passano da richiestaTavily).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const disco = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => (k in disco ? { [k]: structuredClone(disco[k]) } : {}),
      set: async (o) => { Object.assign(disco, structuredClone(o)); },
    },
  },
};
require('../../src/shared/constants.js');
require('../../src/shared/pavimento.js');
require('../../src/main/services/costTracker.js');
require('../../src/main/services/webSearch.js');
const WS = globalThis.SN_WEB_SEARCH;
const Costs = globalThis.SN_COSTS;
let impostazioni = { monthlyLimitEur: 5, usdToEur: 1 };
globalThis.SN_STORAGE = { getSettings: async () => impostazioni };

function reteFinta() {
  const chiamate = [];
  globalThis.fetch = async (url, opts = {}) => {
    chiamate.push(String(url));
    if (String(url).includes('tavily')) {
      return { ok: true, status: 200, json: async () => ({ results: [{ title: 'Museo', url: 'https://museo.example', content: 'orari' }] }), text: async () => '' };
    }
    return { ok: true, status: 200, text: async () => '<a class="result__a" href="https://gratis.example">Gratis</a>' };
  };
  return chiamate;
}

const spesa = async () => (await Costs.getMonthly()).totalEur;

test('ogni ricerca su Tavily entra nel conto del mese, da ogni strada', async () => {
  delete disco[globalThis.SN_CONST.STORAGE_KEYS.COSTS];
  impostazioni = { monthlyLimitEur: 5, usdToEur: 1 };
  const rete = reteFinta();
  const prima = await spesa();
  for (const da of ['chat', 'aiuto', 'correttore']) {
    const r = await WS.search({ query: 'orari del museo egizio', tavilyKey: 'k', da });
    assert.equal(r.provider, 'tavily', da);
  }
  await WS.richiestaTavily({ query: 'gatti', apiKey: 'k', maxResults: 5, extra: { include_images: true } });
  assert.equal(rete.filter((u) => u.includes('tavily')).length, 4);
  const dopo = await spesa();
  assert.ok(Math.abs(dopo - prima - 4 * 0.008) < 1e-9, `conto del mese: ${prima} → ${dopo}`);
  assert.ok((await Costs.getMonthly()).byProvider.tavily > 0);
});

test('il servizio che dice i crediti spesi vale più del listino', async () => {
  delete disco[globalThis.SN_CONST.STORAGE_KEYS.COSTS];
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ results: [], usage: { credits: 3 } }), text: async () => '' });
  await WS.richiestaTavily({ query: 'gatti', apiKey: 'k', maxResults: 5 });
  assert.ok(Math.abs((await spesa()) - 3 * 0.008) < 1e-9);
});

test('col limite del mese raggiunto Tavily non parte: la ricerca va al motore gratuito e il conto non cresce', async () => {
  delete disco[globalThis.SN_CONST.STORAGE_KEYS.COSTS];
  impostazioni = { monthlyLimitEur: 0.01, usdToEur: 1 };
  const rete = reteFinta();
  await WS.search({ query: 'primo', tavilyKey: 'k', da: 'chat' });
  await WS.search({ query: 'secondo', tavilyKey: 'k', da: 'chat' });
  assert.equal(rete.filter((u) => u.includes('tavily')).length, 2, 'sotto il limite parte');
  const fermo = await spesa();
  assert.ok(fermo >= 0.01);
  const r = await WS.search({ query: 'terzo', tavilyKey: 'k', da: 'aiuto' });
  assert.equal(rete.filter((u) => u.includes('tavily')).length, 2, 'oltre il limite Tavily non riceve la ricerca');
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'duckduckgo');
  assert.equal(r.ripiego, undefined, 'il limite non è un guasto di Tavily');
  await assert.rejects(WS.richiestaTavily({ query: 'gatti', apiKey: 'k', maxResults: 5 }), (e) => e.code === 'LIMIT_REACHED');
  assert.equal(await spesa(), fermo);
});

test('senza limite (0) la ricerca parte sempre e si conta', async () => {
  delete disco[globalThis.SN_CONST.STORAGE_KEYS.COSTS];
  impostazioni = { monthlyLimitEur: 0, usdToEur: 1 };
  const rete = reteFinta();
  await WS.search({ query: 'qualcosa', tavilyKey: 'k', da: 'chat' });
  assert.equal(rete.filter((u) => u.includes('tavily')).length, 1);
  assert.ok((await spesa()) > 0);
});
