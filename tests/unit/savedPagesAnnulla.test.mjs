// #844 — «Rimuovi» in «Aperti per dopo» si annulla: la voce torna dov'era, con la sua data e la sua categoria, e
// la tiene il main (la pagina manda solo l'id). «Sposta in» con un nome nuovo crea la categoria, o usa l'omonima.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { BrowserWindow: { getAllWindows: () => [] } };
  return origLoad.call(this, request, parent, isMain);
};

const archivio = {};
globalThis.chrome = { storage: { local: {
  get: async (k) => ({ [k]: JSON.parse(JSON.stringify(archivio[k] ?? null)) ?? undefined }),
  set: async (o) => { Object.assign(archivio, JSON.parse(JSON.stringify(o))); },
} } };
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'messages.js'));
require(join(ROOT, 'src', 'main', 'services', 'savedPages.js'));
require(join(ROOT, 'src', 'main', 'services', 'categorizer.js'));
const SavedPages = globalThis.SN_SAVED_PAGES;
const Categorizer = globalThis.SN_CATEGORIZER;
const { STORAGE_KEYS } = globalThis.SN_CONST;
const MSG = globalThis.SN_MSG.MSG;

const registro = new Map();
require(join(ROOT, 'src', 'main', 'services', 'handlers', 'pages.js'))((t, fn) => registro.set(t, fn), { MSG, maybeCategorizeAsync: async () => {} });
const DA_FILO = 'filo://home/home.html';
const chiedi = (type, msg = {}) => registro.get(type)({ type, ...msg }, { tab: { id: 1, url: DA_FILO }, url: DA_FILO }, DA_FILO);

function semina() {
  archivio[STORAGE_KEYS.CATEGORIES] = [{ id: 'c1', name: 'Video da guardare' }, { id: 'c2', name: 'Ricette' }];
  archivio[STORAGE_KEYS.SAVED_PAGES] = ['a', 'b', 'c', 'd'].map((x, i) => ({
    id: x, url: `https://sito.example/${x}`, title: `Pagina ${x}`, thumbnail: `data:image/jpeg;base64,${x}`,
    savedAt: new Date(Date.parse('2026-09-01T10:00:00Z') - i * 3600e3).toISOString(),
    categoryId: x === 'b' ? 'c1' : null, category: x === 'b' ? 'Video da guardare' : null,
  }));
}
const ids = async () => (await SavedPages.list()).map((p) => p.id);

test('«Annulla» rimette la voce dov\'era, con data, categoria e miniatura', async () => {
  semina();
  const prima = (await SavedPages.list()).find((p) => p.id === 'b');
  await chiedi(MSG.REMOVE_SAVED_PAGE, { id: 'b' });
  assert.deepEqual(await ids(), ['a', 'c', 'd']);
  const r = await chiedi(MSG.RESTORE_SAVED_PAGE, { id: 'b' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.pages.map((p) => p.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual((await SavedPages.list()).find((p) => p.id === 'b'), prima);
});

test('due rimozioni annullate a rovescio tornano nel loro ordine', async () => {
  semina();
  await chiedi(MSG.REMOVE_SAVED_PAGE, { id: 'a' });
  await chiedi(MSG.REMOVE_SAVED_PAGE, { id: 'b' });
  await chiedi(MSG.RESTORE_SAVED_PAGE, { id: 'a' });
  await chiedi(MSG.RESTORE_SAVED_PAGE, { id: 'b' });
  assert.deepEqual(await ids(), ['a', 'b', 'c', 'd']);
});

test('un secondo «Annulla» non fa doppioni, e nemmeno la pagina risalvata nel frattempo', async () => {
  semina();
  await chiedi(MSG.REMOVE_SAVED_PAGE, { id: 'c' });
  await chiedi(MSG.RESTORE_SAVED_PAGE, { id: 'c' });
  const di_nuovo = await chiedi(MSG.RESTORE_SAVED_PAGE, { id: 'c' });
  assert.equal(di_nuovo.ok, false);
  assert.deepEqual(await ids(), ['a', 'b', 'c', 'd']);

  await chiedi(MSG.REMOVE_SAVED_PAGE, { id: 'd' });
  await SavedPages.save({ url: 'https://sito.example/d', title: 'Risalvata' });
  await chiedi(MSG.RESTORE_SAVED_PAGE, { id: 'd' });
  const lista = await SavedPages.list();
  assert.equal(lista.filter((p) => p.url === 'https://sito.example/d').length, 1);
});

test('se la sua categoria è stata eliminata, la voce rimessa torna fra le non categorizzate', async () => {
  semina();
  await chiedi(MSG.REMOVE_SAVED_PAGE, { id: 'b' });
  await Categorizer.deleteCategory('c1');
  await chiedi(MSG.RESTORE_SAVED_PAGE, { id: 'b' });
  const b = (await SavedPages.list()).find((p) => p.id === 'b');
  assert.equal(b.categoryId, null);
  assert.equal(b.category, null);
});

test('«Sposta in» cambia categoria, e verso una che non c\'è più non nasconde la pagina', async () => {
  semina();
  const r = await chiedi(MSG.MOVE_PAGE_CATEGORY, { pageId: 'a', categoryId: 'c2' });
  assert.equal(r.ok, true);
  assert.equal((await SavedPages.list()).find((p) => p.id === 'a').category, 'Ricette');
  const via = await chiedi(MSG.MOVE_PAGE_CATEGORY, { pageId: 'a', categoryId: 'sparita' });
  assert.equal(via.ok, false);
  assert.equal((await SavedPages.list()).find((p) => p.id === 'a').categoryId, 'c2');
  const fuori = await chiedi(MSG.MOVE_PAGE_CATEGORY, { pageId: 'a', categoryId: null });
  assert.equal(fuori.ok, true);
  assert.equal((await SavedPages.list()).find((p) => p.id === 'a').categoryId, null);
});

test('«Nuova categoria…» la crea una volta: lo stesso nome con altre maiuscole è la stessa', async () => {
  semina();
  const r = await chiedi(MSG.MOVE_PAGE_CATEGORY, { pageId: 'a', nome: '  Da leggere  ' });
  assert.equal(r.ok, true);
  assert.equal(r.page.category, 'Da leggere');
  await chiedi(MSG.MOVE_PAGE_CATEGORY, { pageId: 'c', nome: 'da LEGGERE' });
  const cats = await Categorizer.listCategories();
  assert.equal(cats.filter((c) => c.name.toLowerCase() === 'da leggere').length, 1);
  assert.equal((await SavedPages.list()).find((p) => p.id === 'c').categoryId, r.page.categoryId);
});

test('un nome vuoto, troppo lungo o per una pagina che non c\'è non crea categorie', async () => {
  semina();
  const max = globalThis.SN_CONST.CATEGORY_NAME_MAX;
  assert.equal((await chiedi(MSG.MOVE_PAGE_CATEGORY, { pageId: 'a', nome: '   ' })).error, 'empty_name');
  const lungo = await chiedi(MSG.MOVE_PAGE_CATEGORY, { pageId: 'a', nome: 'x'.repeat(max + 1) });
  assert.equal(lungo.error, 'name_too_long');
  assert.equal(lungo.max, max);
  assert.equal((await chiedi(MSG.MOVE_PAGE_CATEGORY, { pageId: 'nessuna', nome: 'Nuova' })).error, 'not_found');
  assert.equal((await Categorizer.listCategories()).length, 2);
});
