// #1097.4 — la cache delle risposte: un tetto per funzione, fuori l'Aiuto e il correttore (chiavi mai uguali), e una
// lettura non riscrive la mappa intera.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let disco = {};
let scritture = 0;
globalThis.chrome = {
  storage: {
    local: {
      async get(k) { return k in disco ? { [k]: structuredClone(disco[k]) } : {}; },
      async set(o) { scritture++; for (const [k, v] of Object.entries(o)) disco[k] = structuredClone(v); },
      async remove(k) { delete disco[k]; },
    },
  },
};
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'main', 'services', 'aiCache.js'));
const C = globalThis.SN_AI_CACHE;
const { ACTIONS, AI_CACHE_MAX_PER_FUNZIONE: TETTO, STORAGE_KEYS } = globalThis.SN_CONST;

const domanda = (i) => [{ role: 'user', content: `domanda ${i}` }];
const metti = (action, i, extra = {}) => C.set({ provider: 'openrouter', model: 'm', messages: domanda(`${action}-${i}`), text: `r${i}`, action, ...extra });
const leggi = (action, i) => C.get({ provider: 'openrouter', model: 'm', messages: domanda(`${action}-${i}`), action });
const voci = () => Object.values(disco[STORAGE_KEYS.AI_CACHE] || {});

beforeEach(async () => { await C.clear(); disco = {}; scritture = 0; });

test('Aiuto e correttore della frase non entrano in cache, né ci leggono', async () => {
  await metti(ACTIONS.HELP, 1);
  await metti(ACTIONS.SPELLCHECK_SEMANTIC, 1);
  assert.equal(voci().length, 0);
  assert.equal(C.esclusa(ACTIONS.HELP), true);
  assert.equal(C.esclusa(ACTIONS.SPELLCHECK_SEMANTIC), true);
  assert.equal(C.esclusa(ACTIONS.EXPLAIN), false);
  await metti(ACTIONS.EXPLAIN, 1);
  assert.equal((await leggi(ACTIONS.EXPLAIN, 1)).text, 'r1');
});

test('una funzione dalle domande sempre nuove non butta fuori le spiegazioni già pagate', async () => {
  for (let i = 0; i < 5; i++) await metti(ACTIONS.EXPLAIN, i);
  for (let i = 0; i < TETTO + 30; i++) await metti(ACTIONS.CATEGORIZE, i);
  for (let i = 0; i < 5; i++) assert.equal((await leggi(ACTIONS.EXPLAIN, i))?.text, `r${i}`, `spiegazione ${i}`);
  assert.equal(voci().filter((e) => e.action === ACTIONS.CATEGORIZE).length, TETTO);
  // Dentro la stessa funzione esce la più vecchia.
  assert.equal(await leggi(ACTIONS.CATEGORIZE, 0), null);
  assert.ok(await leggi(ACTIONS.CATEGORIZE, TETTO + 29));
});

test('una lettura non riscrive la mappa, ma l\'uso recente salva la voce alla scrittura dopo', async () => {
  for (let i = 0; i < TETTO; i++) await metti(ACTIONS.EXPLAIN, i);
  const prima = scritture;
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(await leggi(ACTIONS.EXPLAIN, 0));
  assert.ok(await leggi(ACTIONS.EXPLAIN, 0));
  assert.equal(scritture, prima, 'leggere non scrive');
  await metti(ACTIONS.EXPLAIN, 'nuova');
  assert.ok(await leggi(ACTIONS.EXPLAIN, 0), 'la voce letta da poco resta');
  assert.equal(await leggi(ACTIONS.EXPLAIN, 1), null, 'esce quella usata meno di recente');
});

test('le voci scritte prima del tetto per funzione: una letta prende la sua funzione, una ferma da un mese se ne va', async () => {
  const vecchio = Date.now() - 31 * 24 * 3600 * 1000;
  const k1 = await C.hashKey({ provider: 'openrouter', model: 'm', messages: domanda('x') });
  const k2 = await C.hashKey({ provider: 'openrouter', model: 'm', messages: domanda('y') });
  disco[STORAGE_KEYS.AI_CACHE] = {
    [k1]: { text: 'vecchia letta', provider: 'openrouter', model: 'm', ts: vecchio, lastUsed: vecchio },
    [k2]: { text: 'vecchia ferma', provider: 'openrouter', model: 'm', ts: vecchio, lastUsed: vecchio },
  };
  assert.equal((await C.get({ provider: 'openrouter', model: 'm', messages: domanda('x'), action: ACTIONS.EXPLAIN })).text, 'vecchia letta');
  await metti(ACTIONS.TRANSLATE_SELECTION, 1);
  const mappa = disco[STORAGE_KEYS.AI_CACHE];
  assert.equal(mappa[k1].action, ACTIONS.EXPLAIN);
  assert.equal(mappa[k2], undefined);
});

test('due risposte salvate nello stesso istante restano tutte e due', async () => {
  await Promise.all([metti(ACTIONS.EXPLAIN, 'a'), metti(ACTIONS.EXPLAIN, 'b'), metti(ACTIONS.TRANSLATE_SELECTION, 'c')]);
  assert.equal((await leggi(ACTIONS.EXPLAIN, 'a'))?.text, 'ra');
  assert.equal((await leggi(ACTIONS.EXPLAIN, 'b'))?.text, 'rb');
  assert.equal((await leggi(ACTIONS.TRANSLATE_SELECTION, 'c'))?.text, 'rc');
});
