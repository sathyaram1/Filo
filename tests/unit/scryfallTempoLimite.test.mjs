// Il client Scryfall del main (#792): una richiesta che non risponde si chiude entro il tempo limite con una frase
// leggibile, e non tiene in coda le altre; il rate limit di cortesia resta sulle partenze.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const disco = {};
globalThis.chrome = globalThis.chrome || {};
globalThis.chrome.storage = {
  local: {
    get: async (k) => ({ [k]: disco[k] }),
    set: async (o) => { Object.assign(disco, o); },
  },
};
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'scryfallQuery.js'));
require(join(ROOT, 'src', 'main', 'services', 'scryfall.js'));
const Scry = globalThis.SN_SCRYFALL;

const carta = (id, name) => ({
  id, name, mana_cost: '{R}', cmc: 1, type_line: 'Instant', colors: ['R'], color_identity: ['R'],
  image_uris: { normal: '', art_crop: '' }, prices: { eur: '1.00' }, legalities: { commander: 'legal' },
});
const risposta = (body) => ({ ok: true, status: 200, json: async () => body });
const mai = () => new Promise(() => {});

beforeEach(() => {
  for (const k of Object.keys(disco)) delete disco[k];
  Scry._setTimeoutMs(200);
});

test('una richiesta che non risponde si chiude entro il tempo limite, con una frase e non un codice', async () => {
  Scry._setFetch(mai);
  const t0 = Date.now();
  const e = await Scry.named('Lightning Bolt').then(() => null, (err) => err);
  assert.ok(e, 'deve fallire, non restare appesa');
  assert.ok(Date.now() - t0 < 1500, 'entro il tempo limite');
  assert.equal(Scry.isTimeout(e), true);
  assert.match(e.userText, /^Scryfall, l'archivio delle carte, non ha risposto entro \d+ second[oi]$/);
});

test('una richiesta appesa non tiene in coda quelle dopo (anteprime, prezzi, ricerche)', async () => {
  Scry._setTimeoutMs(5000);
  Scry._setFetch(async (url) => {
    if (/fuzzy=Appesa/.test(String(url))) return mai();
    return risposta(carta('bolt-1', 'Lightning Bolt'));
  });
  const appesa = Scry.named('Appesa').catch(() => {});
  const t0 = Date.now();
  const dopo = await Scry.named('Lightning Bolt');
  assert.equal(dopo && dopo.name, 'Lightning Bolt');
  assert.ok(Date.now() - t0 < 1000, `la seconda ha aspettato ${Date.now() - t0} ms dietro la prima`);
  Scry._setTimeoutMs(1);
  await appesa;
});

test('il rate limit di cortesia resta: le partenze sono distanziate', async () => {
  const partenze = [];
  Scry._setFetch(async () => { partenze.push(Date.now()); return risposta(carta('bolt-1', 'Lightning Bolt')); });
  await Promise.all([Scry.named('a'), Scry.named('b'), Scry.named('c')]);
  assert.equal(partenze.length, 3);
  for (let i = 1; i < partenze.length; i += 1) {
    assert.ok(partenze[i] - partenze[i - 1] >= 100, `partenze a ${partenze[i] - partenze[i - 1]} ms`);
  }
});

test('una ricerca scaduta non si riprova: l\'attesa non si triplica', async () => {
  let chiamate = 0;
  Scry._setFetch(() => { chiamate += 1; return mai(); });
  const e = await Scry.search('o:haste').then(() => null, (err) => err);
  assert.equal(Scry.isTimeout(e), true);
  assert.equal(chiamate, 1);
});

test('chi smette di aspettare chiude subito la sua richiesta', async () => {
  Scry._setTimeoutMs(5000);
  Scry._setFetch(mai);
  const ac = new AbortController();
  const p = Scry.search('o:haste', { signal: ac.signal }).then(() => null, (err) => err);
  setTimeout(() => ac.abort(), 30);
  const t0 = Date.now();
  const e = await p;
  assert.equal(e && e.code, 'ABORT_ERR');
  assert.ok(Date.now() - t0 < 1000);
});

test('carte per id: dopo un tempo limite scaduto le altre non si chiedono, e restano quelle in cache', async () => {
  const k = globalThis.SN_CONST.STORAGE_KEYS.SCRYFALL_CARDS;
  disco[k] = { vecchia: { card: { id: 'vecchia', name: 'Vecchia' }, fetchedAt: 0 } };
  let chiamate = 0;
  Scry._setFetch(() => { chiamate += 1; return mai(); });
  const out = await Scry.cards(['a', 'b', 'vecchia']);
  assert.equal(chiamate, 1);
  assert.equal(out.vecchia && out.vecchia.name, 'Vecchia');
});
