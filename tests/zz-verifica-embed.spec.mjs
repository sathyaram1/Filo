import { test, expect } from './fixtures/electron.mjs';
import { openrouterKey, useOwnModels } from './zz-verifica-helpers.mjs';

test('indicizzazione dal vivo: vettori dal router, fornitore ammesso', async ({ app }) => {
  test.setTimeout(90_000);
  const key = openrouterKey();
  const r = await app.evaluate(async ({}, a) => {
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const C = globalThis.SN_CONST;
    const routing = { ignore: C.providerIgnoreList ? C.providerIgnoreList(C.DEFAULT_EXCLUDED_PROVIDERS) : C.DEFAULT_EXCLUDED_PROVIDERS };
    try {
      const res = await P.embed({ apiKey: a.key, model: 'qwen/qwen3-embedding-8b', texts: ['ricetta della carbonara', 'documentazione di React'], dim: C.EMBED_DIM, providerRouting: routing });
      return { n: res.vectors.length, len: res.vectors.map((v) => v.length), servedBy: res.servedBy, usage: res.usage, sample: res.vectors[0].slice(0, 3) };
    } catch (e) { return { error: String(e.message || e) }; }
  }, { key });
  console.log('LIVE EMBED', JSON.stringify(r));
  expect(r.n).toBe(2);
  expect(r.len).toEqual([256, 256]);
  expect(String(r.servedBy || '')).not.toMatch(/google|alibaba|qwen/i);
});

test('ricerca fra le schede archiviate dal vivo: trova per significato', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const key = openrouterKey();
  await useOwnModels(app, key);
  await app.evaluate(async () => {
    const A = globalThis.SN_ARCHIVED_TABS;
    await A.clear();
    await A.archive({ url: 'https://cucina.test/carbonara', title: 'Carbonara perfetta', summary: 'Ricetta della pasta alla carbonara con guanciale, uova e pecorino.' });
    await A.archive({ url: 'https://react.test/docs', title: 'React docs', summary: 'Documentazione ufficiale della libreria React per interfacce web.' });
    await A.archive({ url: 'https://meteo.test/', title: 'Meteo Milano', summary: 'Previsioni del tempo per Milano nei prossimi giorni.' });
  });
  const page = await openTab('filo://archive');
  await page.waitForTimeout(1000);
  // Prima ricerca: nessuna scheda ha vettori → parte la reindicizzazione.
  let r = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'come si cucina la pasta' }));
  console.log('SEARCH 1', JSON.stringify(r).slice(0, 300));
  await expect.poll(async () => app.evaluate(async () => {
    const l = await globalThis.SN_ARCHIVED_TABS.list();
    return l.filter((x) => Array.isArray(x.embedding) && x.embedding.length).length;
  }), { timeout: 60_000 }).toBe(3);
  const models = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).map((x) => [x.title, x.embedModel, (x.embedding || []).length]));
  console.log('EMBED MODELS', JSON.stringify(models));
  r = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'come si cucina la pasta' }));
  console.log('SEARCH 2', JSON.stringify((r.results || []).map((x) => [x.title, x.score])));
  expect(r.results[0].title).toBe('Carbonara perfetta');
  r = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'libreria javascript per UI' }));
  console.log('SEARCH 3', JSON.stringify((r.results || []).map((x) => [x.title, x.score])));
  expect(r.results[0].title).toBe('React docs');
});

test('cambio del modello di indicizzazione: i vettori vecchi si rifanno', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await useOwnModels(app, 'finta');
  await app.evaluate(async () => {
    const A = globalThis.SN_ARCHIVED_TABS;
    await A.clear();
    const a = await A.archive({ url: 'https://a.test/', title: 'A', summary: 'a' });
    const b = await A.archive({ url: 'https://b.test/', title: 'B', summary: 'b' });
    await A.update(a.id, { embedding: [127, 0], embedModel: 'vecchio/modello' });
    await A.update(b.id, { embedding: [0, 127], embedModel: 'vecchio/modello' });
    globalThis.__zzEmb = 0;
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts, model }) => {
      globalThis.__zzEmb++;
      return { vectors: texts.map((t) => (/B|b$/.test(t) ? [0, 1] : [1, 0])), servedBy: 'DeepInfra', usage: {} };
    };
  });
  const page = await openTab('filo://archive');
  let r = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'b' }));
  console.log('R1', JSON.stringify(r));
  await expect.poll(async () => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).every((x) => x.embedModel === 'qwen/qwen3-embedding-8b')), { timeout: 30_000 }).toBe(true);
  r = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'b' }));
  console.log('R2', JSON.stringify((r.results || []).map((x) => [x.title, x.score])));
  expect(r.results.length).toBe(2);
});

test('archivio senza modello di indicizzazione: la ricerca dice cosa manca?', async ({ app, openTab }) => {
  await useOwnModels(app, 'finta', { models: { archive_embed: '' } });
  await app.evaluate(async () => {
    const A = globalThis.SN_ARCHIVED_TABS;
    await A.clear();
    await A.archive({ url: 'https://a.test/', title: 'Carbonara', summary: 'ricetta' });
  });
  const page = await openTab('filo://archive');
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'carbonara' }));
  console.log('NOEMBED', JSON.stringify(r));
  const search = page.locator('input[type="search"], #search, input[placeholder*="erca"]').first();
  if (await search.count()) {
    await search.fill('carbonara');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: process.env.TEMP + '/zz-archive-noembed.png' });
    console.log('ARCHIVE TEXT', (await page.locator('body').innerText()).slice(0, 600));
  }
});
