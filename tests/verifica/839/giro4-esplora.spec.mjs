// esplorazione: aspetto della conferma e della griglia con le miniature piccole, chiaro e scuro.
import { test, expect } from '../../fixtures/electron.mjs';

const RICCA = (t) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title></head>
  <body style="margin:0;min-height:100vh;background:linear-gradient(135deg,#f6d365,#fda085 40%,#a1c4fd 70%,#c2e9fb)">
  <div style="columns:3;padding:24px;font:15px/1.5 Georgia,serif;color:#3a2a1a">${'<p>Filo mette da parte la pagina per dopo con una miniatura.</p>'.repeat(60)}</div></body></html>`;

test('aspetto', async ({ app, openTab, testServer }) => {
  for (const t of ['Prima pagina', 'Seconda pagina']) {
    const url = testServer.html(RICCA(t));
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await app.evaluate(({ BrowserWindow }) => { globalThis.__filoShortcuts.dispatch('save-for-later', BrowserWindow.getAllWindows().find((w) => w._filoTabs)); });
    await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(400);
    if (t === 'Prima pagina') await page.screenshot({ path: 'tests/.shots/839-g4-conferma-chiaro.png' });
    await expect.poll(() => app.evaluate(async (_e, u) => !!(await globalThis.SN_SAVED_PAGES.list()).find((p) => p.url === u && p.thumbnail), url), { timeout: 8000 }).toBe(true);
  }
  const home = await openTab('filo://home/home.html');
  await home.waitForLoadState('domcontentloaded');
  await home.waitForTimeout(1200);
  await home.screenshot({ path: 'tests/.shots/839-g4-home-chiaro.png' });
  await app.evaluate(async () => {
    const { MSG } = globalThis.SN_MSG;
    await globalThis.SN_HANDLE_MESSAGE({ type: MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' });
  });
  await home.reload();
  await home.waitForTimeout(1500);
  await home.screenshot({ path: 'tests/.shots/839-g4-home-scuro.png' });
  const url = testServer.html(RICCA('Terza pagina'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await app.evaluate(({ BrowserWindow }) => { globalThis.__filoShortcuts.dispatch('save-for-later', BrowserWindow.getAllWindows().find((w) => w._filoTabs)); });
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/839-g4-conferma-scuro.png' });
});
