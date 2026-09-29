// Verifica #839 giro 3 — esplorazione: conferma di ripiego su una scheda interna, PDF, finestra nascosta.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PAGINA = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="background:#fda085"><h1>${t}</h1></body></html>`;

function dispatchAltS(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('save-for-later', win);
  });
}
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.url));
const chiudiNuoveSchede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  for (const t of tm.tabs.filter((y) => y.url.startsWith('filo://newtab/'))) tm.closeTab(t.id);
});

async function contaComparse(pagina, ms) {
  return pagina.evaluate(async (durata) => {
    const visti = new Set();
    let n = 0;
    const guarda = () => {
      for (const p of document.querySelectorAll('.sn-save-confirm')) if (!visti.has(p)) { visti.add(p); n++; }
    };
    guarda();
    const mo = new MutationObserver(guarda);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    await new Promise((r) => setTimeout(r, durata));
    mo.disconnect();
    return n;
  }, ms);
}

test('ripiego su scheda interna (Aperti per dopo davanti): quante volte compare la conferma', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  const home = await openTab('filo://home/home.html');
  await home.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 }).catch(() => {});
  const url = testServer.html(PAGINA('Bloccata'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  await dispatchAltS(app);
  await expect.poll(() => schede(app).then((s) => s.includes(url)), { timeout: 12000 }).toBe(false);
  const n = await contaComparse(home, 13000);
  console.log('COMPARSE su Aperti per dopo:', n, 'schede:', await schede(app));
  const righe = await home.evaluate(() => document.querySelectorAll('.sn-card').length);
  console.log('card nella lista:', righe);
});

test('ripiego su scheda interna (Editor davanti): quante volte compare la conferma', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForTimeout(1500);
  const url = testServer.html(PAGINA('Bloccata 2'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  await dispatchAltS(app);
  await expect.poll(() => schede(app).then((s) => s.includes(url)), { timeout: 12000 }).toBe(false);
  const n = await contaComparse(ed, 13000);
  console.log('COMPARSE su Editor:', n, 'url', ed.url());
});

test('ripiego sull\'unica scheda: nuova scheda, comparse nel tempo e clic', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  const url = testServer.html(PAGINA('Unica'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await chiudiNuoveSchede(app);
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  await dispatchAltS(app);
  let nt = null;
  await expect.poll(() => { nt = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab/'); } catch (_) { return false; } }); return !!nt; }, { timeout: 12000 }).toBe(true);
  await nt.waitForSelector('.sn-save-confirm', { timeout: 12000 });
  const t0 = Date.now();
  const n = await contaComparse(nt, 12000);
  console.log('COMPARSE su newtab in 12s dopo la prima:', n, 'dopo', Date.now() - t0);
});

test('ripiego: clic sulla conferma apre la lista, la lista mostra una conferma?', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  const davanti = await testServer.openReady(openTab, PAGINA('Davanti web'), { pubblico: true });
  const url = testServer.html(PAGINA('Bloccata 3'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  await dispatchAltS(app);
  const pill = davanti.locator('.sn-save-confirm');
  await expect(pill).toBeVisible({ timeout: 12000 });
  await pill.click();
  let home = null;
  await expect.poll(() => { home = app.windows().find((w) => { try { return w.url().startsWith('filo://home/'); } catch (_) { return false; } }); return !!home; }, { timeout: 8000 }).toBe(true);
  const n = await contaComparse(home, 8000);
  console.log('COMPARSE sulla lista dopo il clic:', n);
  const n2 = await contaComparse(davanti, 100);
  console.log('conferme ancora nella pagina davanti:', n2);
});

test('PDF: Alt+S, tempo fino alla chiusura e conferma', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  await testServer.openReady(openTab, PAGINA('Davanti al PDF'), { pubblico: true });
  const pdf = readFileSync(resolve(ROOT, 'tests/fixtures/documenti/documento-con-testo.pdf'));
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://localhost:${server.address().port}/doc.pdf`;
  try {
    const shell = await app.firstWindow();
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    await expect.poll(() => schede(app).then((s) => s.includes(url)), { timeout: 8000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 2500));
    const t0 = Date.now();
    await dispatchAltS(app);
    await expect.poll(() => schede(app).then((s) => s.includes(url)), { timeout: 15000, intervals: [100] }).toBe(false);
    console.log('PDF chiuso dopo ms:', Date.now() - t0);
    const e = await app.evaluate(async (_e, u) => (await globalThis.SN_SAVED_PAGES.list()).find((p) => p.url === u) || null, url);
    console.log('PDF salvato:', !!e, 'miniatura byte:', e && e.thumbnail ? e.thumbnail.length : 0, 'titolo', e && e.title);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('finestra nascosta: Alt+S salva e chiude?', async ({ app, openTab, testServer }) => {
  test.setTimeout(60000);
  await testServer.openReady(openTab, PAGINA('Resta'), { pubblico: true });
  const url = testServer.html(PAGINA('Nascosta'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.minimize(); w.hide(); });
  await new Promise((r) => setTimeout(r, 1000));
  console.log('visibility:', await page.evaluate(() => document.visibilityState));
  const t0 = Date.now();
  await dispatchAltS(app);
  await new Promise((r) => setTimeout(r, 7000));
  const e = await app.evaluate(async (_e, u) => (await globalThis.SN_SAVED_PAGES.list()).find((p) => p.url === u) || null, url);
  console.log('nascosta: salvata', !!e, 'miniatura', !!(e && e.thumbnail), 'ancora aperta', (await schede(app)).includes(url), Date.now() - t0);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.show(); w.restore(); });
  await new Promise((r) => setTimeout(r, 6000));
  const e2 = await app.evaluate(async (_e, u) => (await globalThis.SN_SAVED_PAGES.list()).find((p) => p.url === u) || null, url);
  console.log('dopo show: miniatura', !!(e2 && e2.thumbnail), 'ancora aperta', (await schede(app)).includes(url));
});
