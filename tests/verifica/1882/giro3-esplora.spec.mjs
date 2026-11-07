// Esplorazione del giro 3 di #1882: Cerca dall'Editor e moduli su richiesta dopo i gesti comuni.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, v] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    for (const [a, x] of Object.entries(v.azioni || {})) {
      out[a] = out[a] || { n: 0, fine: {} };
      out[a].n += x.n || 0;
      for (const [f, c] of Object.entries(x.fine || {})) out[a].fine[f] = (out[a].fine[f] || 0) + c;
    }
  }
  return out;
});

test('Cerca dall’Editor conta l’attesa fino alla pagina dei risultati', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const sito = await testServer.openReady(openTab, '<!doctype html><body><p>sessione dei siti</p></body>');
  await app.evaluate(async ({ webContents }, url) => {
    const ses = webContents.getAllWebContents().find((w) => w.getURL() === url).session;
    ses.protocol.handle('https', async (req) => {
      if (!/(^|\.)google\.com$/.test(new URL(req.url).hostname)) return new Response('', { status: 404 });
      await new Promise((r) => setTimeout(r, 3000));
      return new Response('<!doctype html><title>risultati</title><p>risultati</p>', { headers: { 'content-type': 'text/html' } });
    });
  }, sito.url());
  const caricata = (re) => app.evaluate(({ webContents }, src) => webContents.getAllWebContents()
    .some((w) => new RegExp(src).test(w.getURL()) && !w.isLoading()), re);

  const page = await openTab('filo://editor/editor.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  const doc = page.locator('#doc');
  await doc.click();
  await page.keyboard.type('parola da cercare');
  await doc.evaluate((p) => { const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await doc.click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.voce('Cerca').first().click();
  await expect.poll(() => caricata('google\\.com/search'), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await oggi(app))['search-web']?.n || 0, { timeout: 8_000 }).toBe(1);
  console.log('EDITOR', JSON.stringify((await oggi(app))['search-web']));
});

test('dopo i gesti comuni i moduli su richiesta restano da caricare', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><p id="p" style="font-size:22px">Una frase.</p><input id="i" style="width:300px"><a id="a" href="https://example.com/x">un link</a></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const attesa = () => page.evaluate(() => (document.documentElement.dataset.filoSuRichiesta || '').split(',').filter(Boolean));
  console.log('PRONTA', JSON.stringify(await attesa()));
  const menu = menuDi(page);
  await page.locator('#p').click({ button: 'right' });
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');
  console.log('DOPO TESTO', JSON.stringify(await attesa()));
  await page.locator('#i').click();
  await page.keyboard.type('ciao');
  await page.locator('#i').click({ button: 'right' });
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');
  console.log('DOPO CAMPO', JSON.stringify(await attesa()));
  await page.locator('#a').click({ button: 'right' });
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');
  console.log('DOPO LINK', JSON.stringify(await attesa()));
  const errori = [];
  page.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
  expect(errori).toEqual([]);
});
