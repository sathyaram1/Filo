// Il client Scryfall del main (#792): una richiesta che non risponde si chiude entro il tempo limite con una frase
// leggibile, e non tiene in coda le altre; il rate limit di cortesia resta sulle partenze.
// Orologio finto in ogni prova: il tempo passa a tick, e una macchina carica non sposta le partenze (#1063).

import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scorri, inAttesa, finoA } from '../helpers/orologio.mjs';

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
const TEMPO_LIMITE_MS = 200;

// Le partenze prenotate vivono nel modulo: ogni prova parte un'ora dopo la precedente, così l'ultima è già passata.
let ora = Date.now();
beforeEach(() => {
  for (const k of Object.keys(disco)) delete disco[k];
  Scry._setTimeoutMs(TEMPO_LIMITE_MS);
  ora += 3_600_000;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: ora });
});
afterEach(() => mock.timers.reset());

test('una richiesta che non risponde si chiude allo scadere del tempo limite, con una frase e non un codice', async () => {
  Scry._setFetch(mai);
  const esito = inAttesa(Scry.named('Lightning Bolt'));
  await scorri(TEMPO_LIMITE_MS - 1);
  assert.equal(esito.fatto, false, 'prima del tempo limite la richiesta aspetta ancora');
  await scorri(1);
  assert.equal(esito.fatto, true, 'allo scadere deve fallire, non restare appesa');
  assert.equal(Scry.isTimeout(esito.errore), true);
  assert.match(esito.errore.userText, /^Scryfall, l'archivio delle carte, non ha risposto entro \d+ second[oi]$/);
});

test('una richiesta appesa non tiene in coda quelle dopo (anteprime, prezzi, ricerche)', async () => {
  Scry._setTimeoutMs(5000);
  Scry._setFetch(async (url) => {
    if (/fuzzy=Appesa/.test(String(url))) return mai();
    return risposta(carta('bolt-1', 'Lightning Bolt'));
  });
  const appesa = inAttesa(Scry.named('Appesa'));
  const dopo = inAttesa(Scry.named('Lightning Bolt'));
  await scorri(1000);
  assert.equal(dopo.fatto, true, 'la seconda arriva mentre la prima aspetta ancora');
  assert.equal(dopo.valore && dopo.valore.name, 'Lightning Bolt');
  assert.equal(appesa.fatto, false);
  await scorri(4000);
  assert.equal(Scry.isTimeout(appesa.errore), true, 'la prima si chiude lo stesso al suo tempo limite');
});

test('il rate limit di cortesia resta: le partenze sono distanziate', async () => {
  const partenze = [];
  Scry._setFetch(async () => { partenze.push(Date.now()); return risposta(carta('bolt-1', 'Lightning Bolt')); });
  const tutte = Promise.all([Scry.named('a'), Scry.named('b'), Scry.named('c')]);
  await scorri(0);
  assert.equal(partenze.length, 1, 'tre richieste insieme: ne parte una, le altre aspettano il loro turno');
  // A passi piccoli: ogni partenza legge l'ora del passo in cui il suo turno è arrivato.
  await finoA(tutte, { passo: 5, oltre: 1000 });
  assert.equal(partenze.length, 3);
  for (let i = 1; i < partenze.length; i += 1) {
    assert.ok(partenze[i] - partenze[i - 1] >= 100, `partenze a ${partenze[i] - partenze[i - 1]} ms`);
  }
});

test('una ricerca scaduta non si riprova: l\'attesa non si triplica', async () => {
  let chiamate = 0;
  Scry._setFetch(() => { chiamate += 1; return mai(); });
  const e = await finoA(Scry.search('o:haste').then(() => null, (err) => err), { oltre: 10_000 });
  assert.equal(Scry.isTimeout(e), true);
  assert.equal(chiamate, 1);
});

test('chi smette di aspettare chiude subito la sua richiesta', async () => {
  Scry._setTimeoutMs(5000);
  Scry._setFetch(mai);
  const ac = new AbortController();
  const esito = inAttesa(Scry.search('o:haste', { signal: ac.signal }));
  await scorri(30);
  assert.equal(esito.fatto, false);
  ac.abort();
  await scorri(0);
  assert.equal(esito.fatto, true, 'si chiude senza che passi altro tempo, non al tempo limite');
  assert.equal(esito.errore && esito.errore.code, 'ABORT_ERR');
});

test('carte per id: dopo un tempo limite scaduto le altre non si chiedono, e restano quelle in cache', async () => {
  const k = globalThis.SN_CONST.STORAGE_KEYS.SCRYFALL_CARDS;
  disco[k] = { vecchia: { card: { id: 'vecchia', name: 'Vecchia' }, fetchedAt: 0 } };
  let chiamate = 0;
  Scry._setFetch(() => { chiamate += 1; return mai(); });
  const out = await finoA(Scry.cards(['a', 'b', 'vecchia']), { oltre: 10_000 });
  assert.equal(chiamate, 1);
  assert.equal(out.vecchia && out.vecchia.name, 'Vecchia');
});
