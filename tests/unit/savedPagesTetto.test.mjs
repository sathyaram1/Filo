// #1088 — oltre le 1000 pagine salvate la più vecchia usciva senza che nessuno lo dicesse: il tetto resta (l'elenco
// vive in storage.json, che si riscrive intero), ma chi esce lo si dice nella cornice della finestra, col titolo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const detti = [];
const finestra = {
  _filoTabs: {},
  isDestroyed: () => false,
  webContents: { isDestroyed: () => false, isLoading: () => false, send: (canale, info) => detti.push({ canale, ...info }) },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { BrowserWindow: { getAllWindows: () => [finestra] } };
  return origLoad.call(this, request, parent, isMain);
};

const archivio = {};
globalThis.chrome = { storage: { local: {
  get: async (k) => ({ [k]: JSON.parse(JSON.stringify(archivio[k] ?? null)) ?? undefined }),
  set: async (o) => { Object.assign(archivio, JSON.parse(JSON.stringify(o))); },
} } };
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'main', 'services', 'savedPages.js'));
const SavedPages = globalThis.SN_SAVED_PAGES;
const { STORAGE_KEYS, SAVED_PAGES_LIMIT } = globalThis.SN_CONST;

function riempi(n) {
  const base = Date.parse('2026-01-01T00:00:00Z');
  archivio[STORAGE_KEYS.SAVED_PAGES] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, url: `https://sito.example/${i}`, title: i === n - 1 ? 'La più vecchia' : `Pagina ${i}`,
    savedAt: new Date(base + (n - i) * 60e3).toISOString(),
  }));
}

test('a elenco pieno la pagina nuova entra, la più vecchia esce e lo si dice col suo titolo', async () => {
  riempi(SAVED_PAGES_LIMIT);
  detti.length = 0;
  const nuova = await SavedPages.save({ url: 'https://nuova.example/', title: 'Nuova' });
  const lista = await SavedPages.list();
  assert.equal(lista.length, SAVED_PAGES_LIMIT);
  assert.equal(lista[0].id, nuova.id);
  assert.ok(!lista.some((p) => p.title === 'La più vecchia'));
  assert.equal(detti.length, 1);
  assert.equal(detti[0].canale, 'shell:toast');
  assert.match(detti[0].text, /«La più vecchia».*uscita/);
  assert.match(detti[0].text, new RegExp(String(SAVED_PAGES_LIMIT)));
  assert.equal(detti[0].opts.key, 'pagine-salvate-tetto', 'un avviso solo, che si sostituisce');

  // Risalvare una pagina già in elenco non fa uscire nessuno.
  detti.length = 0;
  await SavedPages.save({ url: 'https://sito.example/3', title: 'Di nuovo' });
  assert.equal((await SavedPages.list()).length, SAVED_PAGES_LIMIT);
  assert.equal(detti.length, 0);
});

test('un elenco già oltre il tetto (da un\'importazione di prima) torna al tetto dicendo quante ne escono', async () => {
  riempi(SAVED_PAGES_LIMIT + 3);
  detti.length = 0;
  await SavedPages.save({ url: 'https://altra.example/', title: 'Altra' });
  assert.equal((await SavedPages.list()).length, SAVED_PAGES_LIMIT);
  assert.equal(detti.length, 1);
  assert.match(detti[0].text, /Le 4 più vecchie/);
});

test('sotto il tetto non si dice niente', async () => {
  riempi(10);
  detti.length = 0;
  await SavedPages.save({ url: 'https://ancora.example/', title: 'Ancora' });
  assert.equal((await SavedPages.list()).length, 11);
  assert.equal(detti.length, 0);
});
