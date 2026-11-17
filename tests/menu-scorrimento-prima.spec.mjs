// #2452 — l'evento «scroll» arriva al fotogramma dopo lo scorrimento: quello di uno scorrimento finito prima del tasto
// destro non chiude il menu appena aperto, né nel documento né nello strato; uno scorrimento dopo l'apertura sì.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from './helpers/menuContestuale.mjs';

const VOCE = 'Prova #2452';
const fotogrammi = (page) => page.evaluate(() => new Promise((ok) => {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 150)));
}));
const inCima = (page) => expect.poll(() => page.evaluate(() => new Promise((ok) => {
  window.scrollTo({ top: 0, behavior: 'instant' });
  setTimeout(() => ok(window.scrollY), 200);
}))).toBe(0);
// Scorre e apre nello stesso compito, come Playwright o un utente svelto che porta la voce sotto il puntatore e preme.
const SCORRI_E_APRI = `window.scrollTo({ top: 400, behavior: 'instant' });
  SN_MENU.open({ x: 300, y: 300, items: [{ type: 'item', label: ${JSON.stringify(VOCE)}, onClick() {} }] }); true`;
const SCORRI_AL_PROSSIMO_MENU = `(() => {
  const apri = SN_MENU.open;
  SN_MENU.open = (o) => { SN_MENU.open = apri; window.scrollTo({ top: 400, behavior: 'instant' }); return apri(o); };
  return true;
})()`;

test('una pagina di Filo appena scorsa: il menu aperto resta, e si chiude allo scorrimento dopo', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1' && !!window.SN_MENU, null, { timeout: 10_000 });
  await inCima(page);
  await page.evaluate(SCORRI_E_APRI);
  await fotogrammi(page);
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  await expect(menu.voce(VOCE).first()).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

  await page.evaluate(() => window.scrollBy({ top: 200, behavior: 'instant' }));
  await expect(menu.principale).toHaveCount(0);
});

test.describe('nello strato', () => {
  test.use({ stratoDelMenu: true });

  test('un sito appena scorso: il menu nello strato resta, e si chiude allo scorrimento dopo', async ({ app, openTab, testServer }) => {
    await paginaDelloStrato(app);
    await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
    const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;height:4000px"><p>Una pagina lunga.</p></body>');
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await inCima(page);
    // Lo strato si apre solo dopo un tasto destro vero: la pagina scorre nello stesso compito in cui il menu si apre.
    await app.evaluate(({ BrowserWindow }, { url, code }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
      const tab = tm.tabs.find((t) => t.view && t.view.webContents.getURL() === url);
      return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
    }, { url: page.url(), code: SCORRI_AL_PROSSIMO_MENU });
    await page.mouse.click(300, 300, { button: 'right' });
    await expect.poll(async () => (await statoDelloStrato(app))?.aperto).toBe(true);
    await fotogrammi(page);
    expect((await statoDelloStrato(app)).aperto, 'lo scorrimento di prima non chiude il menu nuovo').toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

    await page.evaluate(() => window.scrollBy({ top: 200, behavior: 'instant' }));
    await expect.poll(async () => (await statoDelloStrato(app))?.aperto).toBe(false);
  });
});
