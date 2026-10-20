// #1054 giro 2 — il menu aperto da tastiera (tasto Menu, Maiusc+F10) si apre anche nello strato, come quello di oggi.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

for (const acceso of [true, false]) {
  test.describe(acceso ? 'strato acceso' : 'strato spento', () => {
    test.use({ stratoDelMenu: acceso });

    test(`tasto Menu e Maiusc+F10 aprono il menu sul campo (${acceso ? 'acceso' : 'spento'})`, async ({ app, openTab, testServer }) => {
      if (acceso) {
        await paginaDelloStrato(app);
        await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
      }
      const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0">
        <input id="campo" value="abc" style="position:absolute;left:100px;top:100px;width:300px"></body>`);
      await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
      await page.locator('#campo').click();
      const menu = menuDi(page);
      for (const tasti of [[{ keyCode: 'Apps' }], [{ keyCode: 'F10', modifiers: ['shift'] }]]) {
        await app.evaluate(({ BrowserWindow }, tasti) => {
          const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
          const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
          for (const t of tasti) {
            wc.sendInputEvent({ type: 'rawKeyDown', ...t });
            wc.sendInputEvent({ type: 'keyUp', ...t });
          }
        }, tasti);
        const ok = await expect(menu.principale).toBeVisible({ timeout: 4000 }).then(() => true, () => false);
        console.log(acceso ? 'ACCESO' : 'SPENTO', JSON.stringify(tasti), ok);
        if (ok) {
          await app.evaluate(({ BrowserWindow }) => {
            const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
            const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
            wc.sendInputEvent({ type: 'rawKeyDown', keyCode: 'Escape' });
            wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
          });
          await expect(menu.pannelli).toHaveCount(0);
        }
      }
    });
  });
}
