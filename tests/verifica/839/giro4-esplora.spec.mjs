// #839 giro 4 — esplorazione: incognito col ripiego del main, doppio Alt+S su pagina bloccata.
import { test, expect } from '../../fixtures/electron.mjs';

const pagina = (t) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title></head><body style="background:#fda085"><h1>${t}</h1></body></html>`;

async function apriIncognito(app, shell) {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w ? w._filoTabs.tabs.length : 0;
  }), { timeout: 15000 }).toBe(1);
}

test('incognito, pagina bloccata: Alt+S non scrive la pagina sul disco', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, pagina('Finestra normale'));
  await apriIncognito(app, shell);
  const url = testServer.html(pagina('Segreta bloccata'));
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    w._filoTabs.openTab(u); w.show(); w.focus();
  }, url);
  let p = null;
  await expect.poll(async () => {
    p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return p ? p.evaluate(() => document.documentElement.dataset.filoContentReady === '1').catch(() => false) : false;
  }, { timeout: 10000 }).toBe(true);
  await p.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
  await p.waitForTimeout(200);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    globalThis.__filoShortcuts.dispatch('save-for-later', w);
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w._filoTabs.tabs.some((t) => t.url === u);
  }, url), { timeout: 12000 }).toBe(false);
  await new Promise((r) => setTimeout(r, 1500));
  const salvate = await app.evaluate(async () => ({
    disco: (await globalThis.SN_SAVED_PAGES.list()).map((x) => x.url),
    sessione: await globalThis.__filoStorage.runIncognito(async () => (await globalThis.SN_SAVED_PAGES.list()).map((x) => x.url)),
  }));
  console.log('SALVATE', JSON.stringify(salvate));
  expect(salvate.disco, 'la pagina in incognito è finita sul disco').toEqual([]);
  expect(salvate.sessione).toEqual([url]);
});

test('doppio Alt+S su una pagina bloccata: una conferma', async ({ app, openTab, testServer }) => {
  const davanti = await testServer.openReady(openTab, pagina('Resto davanti'), { pubblico: true });
  const url = testServer.html(pagina('Bloccata'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 12000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  const altS = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('save-for-later', win);
  });
  await altS();
  await page.waitForTimeout(1500);
  await altS();
  await expect(davanti.locator('.sn-save-confirm').first()).toBeVisible({ timeout: 12000 });
  await davanti.waitForTimeout(2500);
  const n = await davanti.evaluate(() => document.querySelectorAll('.sn-save-confirm').length);
  try { await davanti.screenshot({ path: 'tests/.shots/839-g4-doppio.png' }); } catch (_) {}
  console.log('CONFERME', n);
  expect(n).toBe(1);
});
