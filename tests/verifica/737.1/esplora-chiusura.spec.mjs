// esplorazione: una pagina chiusa poco dopo un clic apre la sua pubblicità mentre se ne va?
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;

for (const evento of ['pagehide', 'beforeunload', 'visibilitychange']) {
  test(`chiusa la scheda dopo un clic, la pagina non apre niente in ${evento}`, async ({ app, openTab, testServer }) => {
    const ad = testServer.html('<title>AD</title>');
    const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><p id="p">articolo</p>
      <script>var AD=${JSON.stringify(ad)};addEventListener(${JSON.stringify(evento)},function(){window.open(AD)})</script></body>`);
    await page.waitForTimeout(5600);
    await page.locator('#p').click();
    await page.waitForTimeout(300);
    await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.closeTab(tm.activeTabId);
    });
    await new Promise((r) => setTimeout(r, 2500));
    expect(await aperteSu(app, ad)).toBe(0);
  });
}
