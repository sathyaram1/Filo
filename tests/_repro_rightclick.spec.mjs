import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>External via navigate</h1>
  <p id="p">Right click here</p>
</body></html>`;

// Riproduce il flusso reale dell'utente: apre una newtab (preload INTERNO),
// poi naviga LA STESSA view verso un sito esterno digitando l'URL.
test('repro: newtab navigata a sito esterno → tasto destro', async ({ app, shell, testServer }) => {
  const url = testServer.html(HTML);
  const target = new URL(url).hostname;
  const targetPort = new URL(url).port;

  // Apri una newtab e ottieni il suo id.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await new Promise((r) => setTimeout(r, 500));
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  console.log('SNAPSHOT', JSON.stringify(snap));
  const newtab = (snap.tabs || snap).find((t) => (t.url || '').startsWith('filo://newtab'));
  expect(newtab, 'no newtab found').toBeTruthy();

  // Naviga la stessa view verso il sito esterno.
  await shell.evaluate(({ id, u }) => window.filoShell.tabs.navigate(id, u), { id: newtab.id, u: url });

  // Trova la Page del WebContentsView ora sull'URL esterno.
  const deadline = Date.now() + 10000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => {
      try { return new URL(w.url()).port === targetPort; } catch (_) { return false; }
    });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(page, 'no external page').toBeTruthy();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await new Promise((r) => setTimeout(r, 800));

  const ready = await page.evaluate(() => ({
    filoReady: document.documentElement.dataset.filoReady,
    hasMenu: !!window.SN_MENU,
    hasContent: document.documentElement.dataset.filoContentScripts,
  }));
  console.log('READY STATE', JSON.stringify(ready));

  await page.locator('#p').click({ button: 'right' });
  await page.waitForTimeout(400);
  const menuCount = await page.locator('.sn-menu').count();
  console.log('MENU COUNT', menuCount);
  expect(menuCount, 'menu Filo non comparso dopo navigate a esterno').toBeGreaterThan(0);
});
