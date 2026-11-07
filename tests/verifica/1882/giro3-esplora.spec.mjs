// Giro 3 di #1882: Cerca dalle altre pagine di Filo nominate dalla segnalazione (Editor, home), e i moduli in attesa su un sito.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const ore = Object.entries(s.ore || {}).filter(([k]) => k.startsWith(`${g}T`)).map(([, v]) => v);
  const tot = {};
  for (const o of ore) for (const [id, v] of Object.entries(o.azioni || {})) {
    const a = tot[id] || (tot[id] = { n: 0, fine: {} });
    a.n += v.n || 0;
    for (const [f, n] of Object.entries(v.fine || {})) a.fine[f] = (a.fine[f] || 0) + n;
  }
  return tot;
});

async function motoreLento(app, openTab, testServer) {
  const sito = await testServer.openReady(openTab, '<!doctype html><body><p>sessione dei siti</p></body>');
  await app.evaluate(async ({ webContents }, url) => {
    const ses = webContents.getAllWebContents().find((w) => w.getURL() === url).session;
    ses.protocol.handle('https', async (req) => {
      if (!/(^|\.)google\.com$/.test(new URL(req.url).hostname)) return new Response('', { status: 404 });
      await new Promise((r) => setTimeout(r, 3000));
      return new Response('<!doctype html><title>risultati</title><p>risultati</p>', { headers: { 'content-type': 'text/html' } });
    });
  }, sito.url());
  return sito;
}
const caricata = (app, re) => app.evaluate(({ webContents }, src) => webContents.getAllWebContents()
  .some((w) => new RegExp(src).test(w.getURL()) && !w.isLoading()), re);

async function cercaDa(app, page, locator) {
  await locator.evaluate((p) => { const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await locator.click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.voce('Cerca').first().click();
  await expect.poll(() => caricata(app, 'google\\.com/search'), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await oggi(app))['search-web']?.n || 0, { timeout: 8_000 }).toBe(1);
  return (await oggi(app))['search-web'].fine;
}

test('Editor: Cerca su testo scritto misura fino ai risultati', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await motoreLento(app, openTab, testServer);
  const page = await openTab('filo://editor/editor.html');
  const doc = page.locator('#doc');
  await expect(doc).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await doc.click();
  await page.keyboard.type('pizzeria napoletana');
  const fine = await cercaDa(app, page, doc);
  console.log('EDITOR fine', JSON.stringify(fine));
  expect(Object.keys(fine)).toEqual(['s5']);
});

test('home: Cerca su un testo della home misura fino ai risultati', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await motoreLento(app, openTab, testServer);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  await page.evaluate(() => {
    const p = Object.assign(document.createElement('p'), { id: 'p-prova', textContent: 'una risposta della chat' });
    p.style.cssText = 'position:fixed;top:120px;left:120px;font-size:22px;z-index:5;background:#fff';
    document.body.append(p);
  });
  const fine = await cercaDa(app, page, page.locator('#p-prova'));
  console.log('HOME fine', JSON.stringify(fine));
  expect(Object.keys(fine)).toEqual(['s5']);
});

test('sito: quali moduli restano in attesa a pagina pronta', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><body><p>x</p><textarea></textarea></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  console.log('ATTESA', await page.evaluate(() => document.documentElement.dataset.filoSuRichiesta));
});
