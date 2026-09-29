// L'archivio delle schede chiuse non ha tetti e non ripaga l'indice (#825).
//
// Prima: oltre 5000 schede le più vecchie sparivano, oltre le ultime 2000 i
// vettori venivano cancellati (quelle schede non si trovavano più per
// contenuto), e ogni ricerca ripagava l'indicizzazione delle stesse 200.
// Qui si asserisce il successo dal punto di vista dell'utente: con 6000 schede
// le ritrova tutte e la ricerca trova una delle prime; la seconda ricerca non
// reindicizza niente; una scheda cancellata non resta in nessun file; il
// backup torna uguale; l'incognito resta fuori; un archivio vecchio si migra.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron, test as testSenzaFixture } from '@playwright/test';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Modelli locali, chiave finta, indicizzazione finta che riconosce «gattopardo»; ogni chiamata si registra.
async function preparaModelli(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__embedCalls = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      globalThis.__embedCalls.push(texts);
      return { vectors: texts.map((t) => (/gattopardo/i.test(t) ? [1, 0] : [0, 1])) };
    };
    // Niente riordino del modello: resta l'ordine per somiglianza.
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({ text: '', provider: 'openrouter', model: 'stub', usage: {} });
  });
}

const cerca = (page, query) => page.evaluate(
  async (q) => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: q }), query);

function fileSotto(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    let st;
    try { st = statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) out.push(...fileSotto(p));
    else out.push(p);
  }
  return out;
}
function fileCheContengono(dir, ago) {
  return fileSotto(dir).filter((f) => {
    try { return readFileSync(f, 'latin1').includes(ago); } catch (_) { return false; }
  });
}
const cartellaDati = (app) => app.evaluate(() => process.env.FILO_USER_DATA);

test('6000 schede: la pagina le riceve tutte e la ricerca per contenuto trova una delle prime', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModelli(app);
  await app.evaluate(async () => {
    const A = globalThis.SN_ARCHIVED_TABS;
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    for (let i = 0; i < 6000; i++) {
      const gatto = i === 3;
      const t = await A.archive({
        url: `https://pagina-${i}.test/`,
        title: gatto ? 'Recensione del Gattopardo' : `Pagina qualunque ${i}`,
        closedAt: new Date(Date.UTC(2025, 0, 1) + i * 600_000).toISOString(),
      });
      await A.update(t.id, { embedding: gatto ? [127, 0] : [0, 127], embedModel: EM, snippet: `testo ${i}` });
    }
    globalThis.__embedCalls = [];
  });

  const page = await openTab('filo://newtab/');
  const elenco = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'get_archived_tabs' }));
  expect(elenco.tabs).toHaveLength(6000);
  expect(elenco.tabs.at(-1).title).toBe('Pagina qualunque 0');

  const r = await cerca(page, 'gattopardo');
  expect(r.results[0].title).toBe('Recensione del Gattopardo');
  // Tutte le schede hanno già il loro vettore: l'unica chiamata è quella della domanda.
  expect(await app.evaluate(() => globalThis.__embedCalls)).toEqual([['gattopardo']]);

  // La Cronologia, senza modifiche ai suoi file, le mostra tutte: anche la più vecchia.
  const cronologia = await openTab('filo://archive/archive.html');
  await expect(cronologia.locator('.arc-tab')).toHaveCount(6000, { timeout: 30_000 });
  await expect(cronologia.locator('.arc-tab', { hasText: 'Pagina qualunque 0' })).toHaveCount(1);
});

test('due ricerche di fila: la prima indicizza le schede senza vettore, la seconda non ripaga niente', async ({ app, openTab }) => {
  await preparaModelli(app);
  await app.evaluate(async () => {
    const A = globalThis.SN_ARCHIVED_TABS;
    // 300 schede senza vettore (più delle 200 che una ricerca indicizzava): il Gattopardo è fra le più vecchie.
    for (let i = 0; i < 300; i++) {
      await A.archive({ url: `https://senza-${i}.test/`, title: i === 5 ? 'Il Gattopardo, riassunto' : `Senza vettore ${i}` });
    }
  });
  const page = await openTab('filo://newtab/');
  await cerca(page, 'gattopardo');
  const EM = await app.evaluate(() => globalThis.SN_TEST_MODELS.registry['qwen-embed'].model);
  await expect.poll(() => app.evaluate(async (_e, em) =>
    (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => t.embedModel === em).length, EM),
  { timeout: 15_000 }).toBe(300);

  await app.evaluate(() => { globalThis.__embedCalls = []; });
  const seconda = await cerca(page, 'gattopardo');
  expect(seconda.results[0].title).toBe('Il Gattopardo, riassunto');
  const terza = await cerca(page, 'gattopardo');
  expect(terza.results[0].title).toBe('Il Gattopardo, riassunto');
  expect(await app.evaluate(() => globalThis.__embedCalls)).toEqual([['gattopardo'], ['gattopardo']]);
});

// #825 giro 1: dopo la migrazione le schede vecchie non avevano vettore, e la prima ricerca in Cronologia non le trovava.
test('la prima ricerca in Cronologia trova già una scheda vecchia rimasta senza vettore', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModelli(app);
  await app.evaluate(async () => {
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const voci = [];
    for (let i = 0; i < 1500; i++) {
      voci.push({
        id: `m${i}`, url: `https://migrata-${i}.test/`, title: i === 1400 ? 'Il Gattopardo, riassunto' : `Migrata ${i}`,
        closedAt: new Date(Date.UTC(2026, 8, 1) - i * 3600e3).toISOString(), coOpenUrls: [],
        // Come le lasciava il tetto di prima: vettore solo sulle più recenti.
        ...(i < 500 ? { embedding: [0, 127], embedModel: EM } : {}),
      });
    }
    await globalThis.SN_ARCHIVED_TABS.importa(voci);
    const veloce = globalThis.SN_PROVIDER_OPENROUTER.embed;
    globalThis.SN_PROVIDER_OPENROUTER.embed = async (a) => {
      await new Promise((ok) => setTimeout(ok, 200));
      return veloce(a);
    };
  });
  const page = await openTab('filo://archive/archive.html');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.arc-tab').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#search').fill('gattopardo');
  await page.locator('#search').press('Enter');
  await expect(page.locator('#searchNote')).toContainText('per pertinenza', { timeout: 30_000 });
  await expect(page.locator('.arc-results .arc-tab').first()).toContainText('Il Gattopardo, riassunto');
});

test('una scheda che il modello non indicizza si trova lo stesso per testo', async ({ app, openTab }) => {
  await preparaModelli(app);
  await app.evaluate(async () => {
    await globalThis.SN_ARCHIVED_TABS.importa([
      { id: 'g', url: 'https://libri.test/', title: 'Il Gattopardo, riassunto', closedAt: '2025-01-10T10:00:00.000Z' },
      { id: 'r', url: 'http://192.168.1.1/', title: 'Pannello del router', casa: true, closedAt: '2025-01-11T10:00:00.000Z' },
      { id: 'a', url: 'https://altro.test/', title: 'Tutt’altro', closedAt: '2025-01-12T10:00:00.000Z' },
    ]);
    // Il fornitore risponde alla domanda ma fallisce sulle schede: niente vettori per nessuna.
    const vero = globalThis.SN_PROVIDER_OPENROUTER.embed;
    globalThis.SN_PROVIDER_OPENROUTER.embed = async (a) => {
      if (a.texts.length > 1 || /riassunto|Tutt/.test(a.texts[0])) throw new Error('fornitore giù');
      return vero(a);
    };
  });
  const page = await openTab('filo://newtab/');
  const libro = await cerca(page, 'gattopàrdo');
  expect(libro.results.map((r) => r.title)).toEqual(['Il Gattopardo, riassunto']);
  expect(libro.results[0].score).toBeUndefined();
  const router = await cerca(page, 'router');
  expect(router.results.map((r) => r.title)).toEqual(['Pannello del router']);
});

test('chiudere una scheda con 6000 già in archivio resta rapido, e storage.json non contiene l\'archivio', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await app.evaluate(async () => {
    const A = globalThis.SN_ARCHIVED_TABS;
    const riassunto = 'parola '.repeat(200);
    const vettore = Array.from({ length: 256 }, (_, k) => (k % 255) - 127);
    for (let i = 0; i < 6000; i++) {
      const t = await A.archive({
        url: `https://pieno-${i}.test/articolo`,
        title: `Articolo ${i}`,
        coOpenUrls: Array.from({ length: 10 }, (_, k) => `https://vicina-${k}.test/`),
      });
      await A.update(t.id, { summary: riassunto, snippet: riassunto.slice(0, 240), embedding: vettore, embedModel: 'm' });
    }
    const A0 = A.archive;
    globalThis.__tempiArchivio = [];
    A.archive = async (meta) => {
      const t0 = performance.now();
      const r = await A0(meta);
      globalThis.__tempiArchivio.push(performance.now() - t0);
      return r;
    };
  });

  const url = testServer.html('<!doctype html><title>Da chiudere</title><body>ciao</body>');
  await openTab(url);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);

  await expect.poll(() => app.evaluate(async (_e, u) =>
    (await globalThis.SN_ARCHIVED_TABS.list()).some((t) => t.url === u), url), { timeout: 8_000 }).toBe(true);
  const tempi = await app.evaluate(() => globalThis.__tempiArchivio);
  console.log(`[misura #825] archiviare una scheda chiusa con 6000 in archivio: ${tempi.map((t) => t.toFixed(2)).join(', ')} ms`);
  expect(tempi.length).toBeGreaterThan(0);
  expect(Math.max(...tempi)).toBeLessThan(100);
  expect(await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length)).toBe(6001);

  await app.evaluate(() => globalThis.__filoStorage.whenSettled());
  const dati = await cartellaDati(app);
  const storage = readFileSync(join(dati, 'storage.json'), 'utf8');
  expect(storage).not.toContain('pieno-0.test');
  expect(JSON.parse(storage).archivedTabs).toBeUndefined();
});

test('cancellata dalla Cronologia, una scheda non si trova più in nessun file della cartella dati', async ({ app, openTab }) => {
  const url = 'https://da-cancellare-825.test/pagina-privata';
  await app.evaluate(async (_e, u) => {
    const A = globalThis.SN_ARCHIVED_TABS;
    const t = await A.archive({ url: u, title: 'Da cancellare' });
    await A.update(t.id, { summary: 'riassunto-privato-825', embedding: [1, 2, 3], embedModel: 'm' });
    await A.archive({ url: 'https://rimane-825.test/', title: 'Rimane', coOpenUrls: [u, 'https://altra-825.test/'] });
    await globalThis.__filoStorage.whenSettled();
  }, url);
  const dati = await cartellaDati(app);
  expect(fileCheContengono(dati, url).length).toBeGreaterThan(0);

  const archivio = await openTab('filo://archive/archive.html');
  const chip = archivio.locator('.arc-tab', { hasText: 'Da cancellare' });
  await expect(chip).toBeVisible({ timeout: 8_000 });
  await chip.click({ button: 'right' });
  await archivio.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Elimina' }).click();
  await expect(chip).toHaveCount(0);
  await expect(archivio.locator('.arc-tab', { hasText: 'Rimane' })).toBeVisible();

  await expect.poll(async () => {
    await app.evaluate(() => globalThis.__filoStorage.whenSettled());
    return fileCheContengono(dati, url);
  }, { timeout: 8_000 }).toEqual([]);
  expect(fileCheContengono(dati, 'riassunto-privato-825')).toEqual([]);
  const rimasta = await app.evaluate(async () =>
    (await globalThis.SN_ARCHIVED_TABS.list()).find((t) => t.title === 'Rimane'));
  expect(rimasta.coOpenUrls).toEqual(['https://altra-825.test/']);
});

test('esporta e reimporta: l\'archivio torna uguale, e reimportare due volte non duplica', async ({ app, openTab }) => {
  const dati = await cartellaDati(app);
  const zip = join(dati, 'backup-825.zip');
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const prima = await app.evaluate(async ({ dialog }, { zip, png }) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: zip });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [zip] });
    const A = globalThis.SN_ARCHIVED_TABS;
    for (let i = 0; i < 40; i++) {
      const t = await A.archive({
        url: `https://backup-${i}.test/`,
        title: `Backup ${i}`,
        favicon: i === 0 ? `data:image/png;base64,${png}` : '',
        coOpenUrls: ['https://insieme.test/'],
        proxy: i === 1 ? { country: 'DE', tier: 'residential' } : null,
      });
      await A.update(t.id, { summary: `riassunto ${i}`, embedding: [i, 100 - i, 7], embedModel: 'm' });
    }
    return A.list();
  }, { zip, png: PNG });
  expect(prima).toHaveLength(40);

  const page = await openTab('filo://newtab/');
  const esportato = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'export_data' }));
  expect(esportato.ok).toBe(true);
  expect(existsSync(zip)).toBe(true);

  await app.evaluate(async () => globalThis.SN_ARCHIVED_TABS.clear());
  expect(await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length)).toBe(0);

  const reimporta = async () => {
    const anteprima = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'import_data_preview' }));
    expect(anteprima.ok).toBe(true);
    const esito = await page.evaluate(async (token) =>
      chrome.runtime.sendMessage({ type: 'import_data_apply', token }), anteprima.token);
    expect(esito.ok).toBe(true);
  };
  await reimporta();
  expect(await app.evaluate(async () => globalThis.SN_ARCHIVED_TABS.list())).toEqual(prima);
  await reimporta();
  expect(await app.evaluate(async () => globalThis.SN_ARCHIVED_TABS.list())).toEqual(prima);
});

test('una scheda chiusa in una finestra incognito non entra in archivio', async ({ app, shell, testServer }) => {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);

  const privata = testServer.html('<!doctype html><title>Privata 825</title><body>incognito</body>');
  const normale = testServer.html('<!doctype html><title>Normale 825</title><body>normale</body>');
  const apriEChiudi = (incognito, url) => app.evaluate(async ({ BrowserWindow }, { incognito, url }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !!w._filoIncognito === incognito && w._filoTabs);
    const tm = win._filoTabs;
    const id = tm.openTab(url);
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      const tab = tm.tabs.find((t) => t.id === id);
      if (tab && tab.url === url && /825/.test(tab.title || '')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    tm.closeTab(id);
  }, { incognito, url });

  await apriEChiudi(true, privata);
  await apriEChiudi(false, normale);
  // La scheda normale, chiusa dopo, c'è: a quel punto quella incognito avrebbe già avuto il tempo di arrivare.
  await expect.poll(() => app.evaluate(async (_e, u) =>
    (await globalThis.SN_ARCHIVED_TABS.list()).some((t) => t.url === u), normale), { timeout: 8_000 }).toBe(true);
  const urls = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((t) => t.url));
  expect(urls).not.toContain(privata);
  const dati = await cartellaDati(app);
  expect(fileCheContengono(join(dati, 'archivio-schede'), privata)).toEqual([]);
});

testSenzaFixture('un archivio pieno in storage.json si migra intero, riassunti e vettori compresi', async () => {
  testSenzaFixture.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-migra-archivio-');
  const vecchio = [];
  for (let i = 4999; i >= 0; i--) {
    vecchio.push({
      id: `v-${i}`,
      url: `https://migrata-${i}.test/`,
      title: `Migrata ${i}`,
      favicon: '',
      identityColor: i % 2 ? '#aa5500' : null,
      openedAt: null,
      closedAt: new Date(Date.UTC(2025, 5, 1) + i * 3600_000).toISOString(),
      reason: 'manual',
      coOpenUrls: [],
      scrollPosition: null,
      proxy: null,
      summary: `Riassunto ${i}`,
      snippet: `snippet ${i}`,
      embedding: i < 3000 ? [i % 127, 1, -1] : null,
      ...(i < 3000 ? { embedModel: 'vecchio-modello' } : {}),
    });
  }
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ archivedTabs: vecchio }), 'utf8');

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const dopo = await app.evaluate(async () => globalThis.SN_ARCHIVED_TABS.list());
    expect(dopo).toHaveLength(vecchio.length);
    expect(dopo).toEqual(vecchio);
    await expect.poll(async () => {
      await app.evaluate(() => globalThis.__filoStorage.whenSettled());
      return 'archivedTabs' in JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    }, { timeout: 8_000 }).toBe(false);
    expect(readFileSync(join(userData, 'storage.json'), 'utf8')).not.toContain('migrata-0.test');
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});

// #825 giro 2: l'indicizzazione partiva solo alla ricerca, e con un archivio grande la prima ricerca aspettava e sbagliava.
testSenzaFixture('dopo la migrazione le schede senza vettore si indicizzano da sole, e la prima ricerca le trova subito', async () => {
  testSenzaFixture.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-indice-archivio-');
  const vecchio = [];
  for (let i = 0; i < 3000; i++) {
    vecchio.push({
      id: `m${i}`, url: `https://migrata-${i}.test/`, title: i === 2500 ? 'Il Gattopardo' : `Pagina ${i}`,
      closedAt: new Date(Date.UTC(2026, 8, 1) - i * 3600e3).toISOString(), reason: 'manual', coOpenUrls: [],
      summary: i === 2500 ? 'Romanzo di Tomasi di Lampedusa: la nobiltà siciliana davanti all\'Unità.' : `Riassunto ${i}`,
      // Come le lasciava il tetto di prima: vettore solo sulle più recenti.
      ...(i < 1000 ? { embedding: [0, 127], embedModel: 'qwen/qwen3-embedding-8b' } : {}),
    });
  }
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ archivedTabs: vecchio }), 'utf8');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    // Chiave e modelli arrivano ad app aperta, perché il fornitore finto si installa solo da qui.
    await preparaModelli(app);
    await app.evaluate(() => {
      const finto = globalThis.SN_PROVIDER_OPENROUTER.embed;
      globalThis.SN_PROVIDER_OPENROUTER.embed = async (a) => finto({ texts: a.texts.map((t) => t.replace(/nobilt/i, 'gattopardo')) });
    });
    // Nessuna ricerca: l'indice si fa da sé.
    await expect.poll(() => app.evaluate(async () =>
      (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => !t.embedding).length), { timeout: 60_000 }).toBe(0);

    await app.evaluate(() => { globalThis.__embedCalls = []; });
    await shell.evaluate(() => window.filoShell.tabs.open('filo://archive/archive.html'));
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://archive')); return !!page; }).toBe(true);
    await expect(page.locator('.arc-tab').first()).toBeVisible({ timeout: 30_000 });
    await page.locator('#search').fill('libro sulla nobiltà in Sicilia');
    await page.locator('#search').press('Enter');
    await expect(page.locator('#searchNote')).toContainText('per pertinenza', { timeout: 10_000 });
    await expect(page.locator('.arc-results .arc-tab').first()).toContainText('Il Gattopardo');
    expect(await app.evaluate(() => globalThis.__embedCalls.map((t) => t.length))).toEqual([1]);
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});

test('cambiato il modello di indicizzazione, l\'archivio si rifà da solo senza aspettare una ricerca', async ({ app }) => {
  await preparaModelli(app);
  await app.evaluate(async () => {
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const voci = [];
    for (let i = 0; i < 300; i++) {
      voci.push({ id: `c${i}`, url: `https://cambio-${i}.test/`, title: `Cambio ${i}`, embedding: [0, 127], embedModel: EM });
    }
    await globalThis.SN_ARCHIVED_TABS.importa(voci);
    const reg = globalThis.SN_TEST_MODELS.registry;
    await globalThis.SN_STORAGE.updateSettings({
      modelRegistry: { ...reg, 'qwen-embed': { ...reg['qwen-embed'], model: 'qwen/altro-embed' } },
    });
  });
  await expect.poll(() => app.evaluate(async () =>
    (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => t.embedModel === 'qwen/altro-embed').length),
  { timeout: 20_000 }).toBe(300);
});
