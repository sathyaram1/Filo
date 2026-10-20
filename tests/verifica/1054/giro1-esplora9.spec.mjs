// Esplorazione del verificatore (#1054 giro 1): la finestra che si accorcia e la pagina che scorre a menu aperto.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });
const PAGINA = `<!doctype html><html><body style="margin:0;font:16px sans-serif;height:4000px">
  <div style="height:55vh"></div><a id="link" href="https://example.com/a">un collegamento</a></body></html>`;

for (const acceso of [false, true]) {
  test.describe(`strato ${acceso ? 'acceso' : 'spento'}`, () => {
    test.use({ stratoDelMenu: acceso });
    test('finestra accorciata e pagina che scorre', async ({ app, openTab, testServer }) => {
      test.setTimeout(90_000);
      if (acceso) { await paginaDelloStrato(app); await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true); }
      const page = await testServer.openReady(openTab, PAGINA);
      await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
      const menu = menuDi(page);
      const esiti = {};
      // finestra accorciata
      await page.locator('#link').click({ button: 'right' });
      await expect(menu.principale).toBeVisible();
      const b = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const b = w.getBounds(); w.setBounds({ ...b, height: b.height - 340 }); return b; });
      await pausa(1500);
      esiti.dopoAccorcia = await menu.principale.count();
      if (esiti.dopoAccorcia) {
        const r = await menu.principale.boundingBox();
        const vh = await menu.valuta(() => innerHeight);
        esiti.dentro = r.y >= 0 && r.y + r.height <= vh + 1;
      }
      await app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setBounds(b), b);
      await pausa(1000);
      await page.keyboard.press('Escape');
      await pausa(300);
      // pagina che scorre da sola (script del sito) e da tastiera
      for (const [nome, fa] of [['script', () => page.evaluate(() => scrollBy(0, 300))], ['PageDown', () => page.keyboard.press('PageDown')]]) {
        await page.evaluate(() => scrollTo(0, 0));
        await pausa(300);
        await page.locator('#link').click({ button: 'right' });
        await expect(menu.principale).toBeVisible();
        await pausa(300);
        await fa();
        await pausa(900);
        esiti[`dopo-${nome}`] = { menu: await menu.principale.count(), scrollY: await page.evaluate(() => scrollY) };
        await page.keyboard.press('Escape');
        await pausa(300);
      }
      console.log(`SCORRE ${acceso}`, JSON.stringify(esiti));
    });
  });
}
