// #737.1 giro 6 — Una voce del menu di Filo scelta con un clic non è un clic dato alla pagina: la pubblicità che la
// pagina apre a ogni clic non deve passare.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;

test('scegliere «Copia URL» nel menu di Filo non lascia alla pagina aprire la sua pubblicità', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><a id="l" href="https://example.com/x">collegamento</a>
    <script>var AD=${JSON.stringify(ad)};document.addEventListener('click',function(){window.open(AD)},true)</script></body>`);
  await page.locator('#l').click({ button: 'right', position: { x: 8, y: 8 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(5600);
  await menu.locator('button', { hasText: 'Copia URL' }).first().click();
  await page.waitForTimeout(2000);
  expect(await aperteSu(app, ad), 'nessuna pubblicità dal clic sul menu di Filo').toBe(0);
});
