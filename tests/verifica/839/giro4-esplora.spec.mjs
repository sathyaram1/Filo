// esplorazione: salvata una pagina, l'utente passa subito a un'altra scheda: la scheda salvata si chiude?
import { test, expect } from '../../fixtures/electron.mjs';

const pagina = (t) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title></head><body style="background:#fda085"><h1>${t}</h1></body></html>`;

const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.url));
const attiva = (app, u) => app.evaluate(({ BrowserWindow }, x) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((y) => y.url === x);
  if (t) tm.activate(t.id);
}, u);

for (const strada of ['Alt+S', 'menu']) {
  test(`${strada}, poi subito un'altra scheda: la salvata si chiude lo stesso`, async ({ app, openTab, testServer }) => {
    const altra = testServer.html(pagina('Altra scheda'), { pubblico: true });
    await openTab(altra);
    const url = testServer.html(pagina('Da salvare'));
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    if (strada === 'Alt+S') {
      await app.evaluate(({ BrowserWindow }) => { globalThis.__filoShortcuts.dispatch('save-for-later', BrowserWindow.getAllWindows().find((w) => w._filoTabs)); });
    } else {
      await page.click('body', { button: 'right', position: { x: 400, y: 300 } });
      await page.locator('.sn-menu [data-sn-icon-id="saveForLater"]').click();
    }
    await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
    await attiva(app, altra);
    await new Promise((r) => setTimeout(r, 8000));
    const dopo8 = await schede(app);
    console.log(strada, 'DOPO 8s', JSON.stringify(dopo8));
    await attiva(app, url);
    await new Promise((r) => setTimeout(r, 1500));
    console.log(strada, 'TORNATO', JSON.stringify(await schede(app)));
    expect(dopo8, 'la pagina salvata è rimasta aperta dietro').not.toContain(url);
  });
}
