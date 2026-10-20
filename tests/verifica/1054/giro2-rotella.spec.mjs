// #1054 giro 2 — la rotella fuori dal menu normale chiude il menu E fa scorrere la pagina, come col menu di oggi.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><body style="margin:0;font:16px sans-serif;height:4000px">
  <a id="link" href="https://example.com/a" style="position:absolute;left:300px;top:200px">un collegamento</a></body>`;

for (const acceso of [true, false]) {
  test.describe(acceso ? 'strato acceso' : 'strato spento', () => {
    test.use({ stratoDelMenu: acceso });

    test(`la rotella fuori dal menu di un collegamento fa scorrere la pagina e chiude il menu (${acceso ? 'acceso' : 'spento'})`, async ({ app, openTab, testServer }) => {
      if (acceso) {
        await paginaDelloStrato(app);
        await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
      }
      const page = await testServer.openReady(openTab, PAGINA);
      await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
      await page.locator('#link').click({ button: 'right' });
      const menu = menuDi(page);
      await expect(menu.principale).toBeVisible();
      // Il puntatore lontano dal menu, una tacca di rotella: la pagina scorre (come col menu nella pagina) e il menu va via.
      const sup = menu.superficie;
      await sup.mouse.move(900, 600);
      await sup.mouse.wheel(0, 300);
      await expect.poll(() => menu.pannelli.count()).toBe(0);
      await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(50);
    });
  });
}
