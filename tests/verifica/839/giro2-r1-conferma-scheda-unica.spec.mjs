// #839 — secondo giro, rilievo 1: Alt+S sull'unica scheda aperta, quando la pagina non può confermare da sé
// (bloccata, o ancora in caricamento): la scheda si chiude e la conferma non compare da nessuna parte.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const PAGINA = (titolo) => `<!doctype html><html><head><title>${titolo}</title></head>
  <body style="margin:0;min-height:100vh;background:linear-gradient(135deg,#f6d365,#a1c4fd)"><h1 style="padding:40px">${titolo}</h1></body></html>`;

function altS(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('save-for-later', win);
  });
}

const chiudiNuovaScheda = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  for (const t of tm.tabs.filter((y) => y.url.startsWith('filo://newtab/'))) tm.closeTab(t.id);
});
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.url));
const salvata = (app, u) => app.evaluate(async (_e, x) => (await globalThis.SN_SAVED_PAGES.list()).find((p) => p.url === x) || null, u);

async function confermaCompare(app, ms) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => !!document.querySelector('.sn-save-confirm'))) return w.url(); } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

test('pagina bloccata, unica scheda: dopo il salvataggio la conferma compare', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(PAGINA('Unica bloccata'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await chiudiNuovaScheda(app);
  expect(await schede(app)).toEqual([url]);
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  await altS(app);
  await expect.poll(() => salvata(app, url).then((s) => !!s), { timeout: 12000 }).toBe(true);
  expect(await confermaCompare(app, 6000), 'la pagina è stata salvata e chiusa senza nessuna conferma').not.toBeNull();
});

test('pagina ancora in caricamento, unica scheda: dopo il salvataggio la conferma compare', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const lento = createServer((req, res) => {
    if (req.url.startsWith('/lento.js')) return; // non arriva mai: la pagina resta in caricamento
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Lenta</title></head><body><h1>Si carica</h1><script src="/lento.js"></script></body></html>');
  });
  await new Promise((r) => lento.listen(0, '127.0.0.1', r));
  const url = `http://localhost:${lento.address().port}/p`;
  try {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    await expect.poll(() => schede(app).then((s) => s.includes(url)), { timeout: 8000 }).toBe(true);
    await chiudiNuovaScheda(app);
    await new Promise((r) => setTimeout(r, 800));
    expect(await schede(app)).toEqual([url]);
    await altS(app);
    await expect.poll(() => salvata(app, url).then((s) => !!s), { timeout: 12000 }).toBe(true);
    expect(await confermaCompare(app, 6000), 'la pagina è stata salvata e chiusa senza nessuna conferma').not.toBeNull();
  } finally {
    lento.closeAllConnections?.();
    await new Promise((r) => lento.close(r));
  }
});
