// #589.12 — l'elenco «salva per dopo» (indirizzi, titoli, miniature, categorie) non esce verso un sito, da nessun
// canale di handlers/pages.js né dal messaggio della home, dallo stato o dalla chat di Filo; le pagine di Filo lo leggono
// intero. Ogni handler nuovo di pages.js passa da qui da solo: chi risponde a un sito con una voce intera diventa rosso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'messages.js'));
const MSG = globalThis.SN_MSG.MSG;

const MINIATURA_A = 'data:image/jpeg;base64,TUlOSUFUVVJBLUE=';
const voceA = () => ({
  id: 'a1', url: 'https://banca.example/conto', title: 'Conto della banca', favicon: 'https://banca.example/f.ico',
  thumbnail: MINIATURA_A, savedAt: '2026-10-03T10:00:00.000Z', category: 'Finanza', categoryId: 'c1',
});

function montaHandler() {
  const stato = { pagine: [voceA()], categorie: [{ id: 'c1', name: 'Finanza', thumbnailUrl: MINIATURA_A }, { id: 'c2', name: 'Svago', thumbnailUrl: '' }] };
  globalThis.SN_SAVED_PAGES = {
    list: async () => stato.pagine,
    save: async (p) => {
      const ex = stato.pagine.find((x) => x.url === p.url);
      if (ex) { ex.title = p.title || ex.title; return ex; }
      const e = { id: 'n' + stato.pagine.length, url: p.url, title: p.title || p.url, thumbnail: '', category: null };
      stato.pagine.unshift(e);
      return e;
    },
    setThumbnail: async (id, t) => { const e = stato.pagine.find((x) => x.id === id); if (e) e.thumbnail = t; return e || null; },
    remove: async (id) => (stato.pagine = stato.pagine.filter((x) => x.id !== id)),
    consume: async (id) => (stato.pagine = stato.pagine.filter((x) => x.id !== id)),
  };
  globalThis.SN_CATEGORIZER = {
    listCategories: async () => stato.categorie,
    findByName: (cats, n) => cats.find((c) => c.name === n) || null,
    renameCategory: async (id, name) => { const c = stato.categorie.find((x) => x.id === id); if (c) c.name = name; return c; },
    deleteCategory: async (id) => (stato.categorie = stato.categorie.filter((x) => x.id !== id)),
    mergeCategories: async () => {},
    movePageToCategory: async (pid) => stato.pagine.find((x) => x.id === pid) || null,
  };
  const registro = new Map();
  const percorso = join(ROOT, 'src', 'main', 'services', 'handlers', 'pages.js');
  delete require.cache[percorso];
  require(percorso)((t, fn) => registro.set(t, fn), { MSG, maybeCategorizeAsync: async () => {} });
  return { stato, registro };
}

// Cattura finta: piccola e già nel formato che la miniatura accetta.
const catturaFinta = { isEmpty: () => false, getSize: () => ({ width: 8, height: 6 }), toJPEG: () => Buffer.from('MINIATURA-B') };
const SITO_B = 'https://sito-b.example/pagina';
const daSitoB = {
  tab: { id: 7, url: SITO_B }, url: SITO_B,
  win: { _filoTabs: { tabs: [{ id: 7, view: { webContents: { capturePage: async () => catturaFinta } } }] } },
};
const DA_FILO = { tab: { id: 1, url: 'filo://newtab/' }, url: 'filo://newtab/' };
// Tutto ciò che un sito potrebbe mandare per far parlare un handler della voce A.
const richiestaDelSito = {
  id: 'a1', pageId: 'a1', categoryId: 'c2', fromId: 'c1', toId: 'c2', name: 'Svago', unisci: false,
  page: { url: 'https://banca.example/conto', title: '' }, url: 'https://banca.example/conto', title: '',
};

test('nessun canale delle pagine salvate risponde a un sito con indirizzo, titolo o miniatura di una voce', async () => {
  const { registro } = montaHandler();
  const tipi = [...registro.keys()].filter((t) => t !== MSG.SHORTCUT_RECEIPT);
  assert.ok(tipi.includes(MSG.GET_SAVED_PAGES) && tipi.includes(MSG.GET_CATEGORIES), 'il registro non ha montato gli handler');
  for (const tipo of tipi) {
    const { registro: r } = montaHandler();
    const risposta = JSON.stringify(await r.get(tipo)({ type: tipo, ...richiestaDelSito }, daSitoB, SITO_B) ?? null);
    assert.ok(!risposta.includes('TUlOSUFUVVJBLUE'), `${tipo} dà a un sito la miniatura di un altro: ${risposta.slice(0, 160)}`);
    assert.ok(!risposta.includes('data:image'), `${tipo} dà a un sito una miniatura: ${risposta.slice(0, 160)}`);
    assert.ok(!risposta.includes('Conto della banca'), `${tipo} dà a un sito il titolo di una voce: ${risposta.slice(0, 160)}`);
    assert.ok(!risposta.includes('banca.example'), `${tipo} dà a un sito l'indirizzo di una voce: ${risposta.slice(0, 160)}`);
  }
});

test('un sito non toglie, non sposta e non rinomina le voci salvate', async () => {
  for (const tipo of [MSG.REMOVE_SAVED_PAGE, MSG.CONSUME_SAVED_PAGE, MSG.DELETE_CATEGORY, MSG.RENAME_CATEGORY, MSG.MOVE_PAGE_CATEGORY, MSG.MERGE_CATEGORIES]) {
    const { stato, registro } = montaHandler();
    const r = await registro.get(tipo)({ type: tipo, ...richiestaDelSito }, daSitoB, SITO_B);
    assert.deepEqual(r, { ok: false, error: 'forbidden' }, tipo);
    assert.equal(stato.pagine.length, 1, tipo);
    assert.deepEqual(stato.categorie.map((c) => c.name), ['Finanza', 'Svago'], tipo);
  }
});

test('il salvataggio da un sito risponde con id e categoria, quello che la conferma e la miniatura usano', async () => {
  const { registro, stato } = montaHandler();
  const r = await registro.get(MSG.SAVE_PAGE)({ type: MSG.SAVE_PAGE, page: { url: SITO_B, title: 'Pagina B' } }, daSitoB, SITO_B);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.entry).sort(), ['category', 'id']);
  const t = await registro.get(MSG.SET_SAVED_PAGE_THUMB)({ type: MSG.SET_SAVED_PAGE_THUMB, id: r.entry.id }, daSitoB, SITO_B);
  assert.equal(t.ok, true);
  assert.ok(stato.pagine.find((p) => p.id === r.entry.id).thumbnail.startsWith('data:image/jpeg;base64,'), 'la miniatura non è stata salvata');
  assert.ok(!JSON.stringify(t).includes('data:image'));
});

test('le pagine di Filo leggono l\'elenco intero, miniature comprese', async () => {
  const { registro } = montaHandler();
  const elenco = await registro.get(MSG.GET_SAVED_PAGES)({ type: MSG.GET_SAVED_PAGES }, DA_FILO, 'filo://newtab/');
  assert.equal(elenco.ok, true);
  assert.equal(elenco.pages[0].thumbnail, MINIATURA_A);
  assert.equal(elenco.pages[0].title, 'Conto della banca');
  const cat = await registro.get(MSG.GET_CATEGORIES)({ type: MSG.GET_CATEGORIES }, DA_FILO, 'filo://options/options.html');
  assert.equal(cat.categories[0].thumbnailUrl, MINIATURA_A);
  const via = await registro.get(MSG.REMOVE_SAVED_PAGE)({ type: MSG.REMOVE_SAVED_PAGE, id: 'a1' }, DA_FILO, 'filo://newtab/');
  assert.deepEqual(via, { ok: true, pages: [] });
});

test('il messaggio della home, che mette in fila le pagine salvate, si chiede solo da una pagina di Filo', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers', 'filo.js'), 'utf8');
  const corpo = src.slice(src.indexOf('on(MSG.FILO_GENERATE_DASHBOARD'), src.indexOf('handleFiloGenerateDashboard('));
  assert.match(corpo, /if \(!isFilo\(origin\)\) return \{[^}]*forbidden/, 'FILO_GENERATE_DASHBOARD risponde anche a un sito');
});

test('lo stato di Filo, che contiene il messaggio della home e le schede aperte, si chiede solo da una pagina di Filo', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers', 'filo.js'), 'utf8');
  const inizio = src.indexOf('on(MSG.FILO_GET_STATE');
  const corpo = src.slice(inizio, src.indexOf('FiloState.assemble(', inizio));
  assert.match(corpo, /if \(!isFilo\(origin\)\) return \{[^}]*forbidden/, 'FILO_GET_STATE risponde anche a un sito');
});

test('la chat di Filo, che ha davanti lo stato intero, e memoria, timer e notifiche rispondono solo alle pagine di Filo', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'services', 'handlers', 'filo.js'), 'utf8');
  const tipi = ['FILO_CHAT', 'FILO_GET_MEMORY', 'FILO_GET_TIMERS', 'FILO_ADD_TIMER', 'FILO_DELETE_TIMER', 'FILO_PAUSE_TIMER',
    'FILO_RESUME_TIMER', 'FILO_STOP_TIMER_ALARM', 'FILO_GET_NOTIFICATIONS', 'FILO_DISMISS_NOTIFICATION', 'FILO_INSTALLA_AGGIORNAMENTO'];
  for (const t of tipi) assert.match(src, new RegExp(`on\\(MSG\\.${t}, soloFilo\\(`), `${t} risponde anche a un sito`);
  assert.match(src, /const soloFilo = \(fn\) => \(msg, sender, origin\) => \(\s*isFilo\(origin\) \? fn\(/);
});
