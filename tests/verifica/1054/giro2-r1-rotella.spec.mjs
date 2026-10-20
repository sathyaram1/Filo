// #1054 giro 2 — la rotella fuori dal menu di un collegamento chiude il menu E fa scorrere la pagina, come col menu di oggi
// (nella pagina la rotella scorre e lo scorrimento chiude il menu). Nello strato il primo giro chiude e basta.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

test.use({ stratoDelMenu: true });

test('r1 la rotella fuori dal menu di un collegamento fa scorrere la pagina e chiude il menu', async ({ app, openTab, testServer }) => {
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;font:16px sans-serif;height:4000px">
    <a id="link" href="https://example.com/a" style="position:absolute;left:300px;top:200px">un collegamento</a></body>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#link').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  // Il puntatore lontano dal menu, sopra la pagina: un giro di rotella.
  await menu.superficie.mouse.move(900, 600);
  await menu.superficie.mouse.wheel(0, 300);
  await expect.poll(() => menu.pannelli.count()).toBe(0);
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 3000, message: 'la pagina deve scorrere' }).toBeGreaterThan(50);
});
