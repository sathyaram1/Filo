// #839 giro 4 r2 — un secondo Alt+S su una pagina che non risponde fa comparire due conferme uguali.
import { test, expect } from '../../fixtures/electron.mjs';

const pagina = (t) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title></head><body style="background:#fda085"><h1>${t}</h1></body></html>`;

test('doppio Alt+S su una pagina bloccata: una conferma sola', async ({ app, openTab, testServer }) => {
  const davanti = await testServer.openReady(openTab, pagina('Resto davanti'), { pubblico: true });
  const url = testServer.html(pagina('Bloccata'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 12000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  const altS = () => app.evaluate(({ BrowserWindow }) => {
    globalThis.__filoShortcuts.dispatch('save-for-later', BrowserWindow.getAllWindows().find((w) => w._filoTabs));
  });
  await altS();
  // Per tre secondi e mezzo non succede niente: chi preme di nuovo è il caso naturale.
  await page.waitForTimeout(1500);
  await altS();

  await expect(davanti.locator('.sn-save-confirm').first()).toBeVisible({ timeout: 12000 });
  await davanti.waitForTimeout(2500);
  expect(await davanti.evaluate(() => document.querySelectorAll('.sn-save-confirm').length), 'una conferma per una pagina salvata').toBe(1);
});
