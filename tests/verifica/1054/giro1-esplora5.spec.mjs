// Esplorazione del verificatore (#1054 giro 1): aspetto in tema scuro, cronologia e griglia, strato contro pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';
import { cronologiaPronta } from '../../helpers/cronologiaAppunti.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

for (const acceso of [false, true]) {
  test.describe(`strato ${acceso ? 'acceso' : 'spento'}`, () => {
    test.use({ stratoDelMenu: acceso });

    test('scuro', async ({ app, openTab, testServer }) => {
      test.setTimeout(90_000);
      await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
      if (acceso) { await paginaDelloStrato(app); await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true); }
      for (const t of ['primo appunto', 'secondo appunto lungo lungo lungo lungo lungo lungo lungo lungo lungo lungo lungo', '<b>html</b> & 😀']) {
        await app.evaluate(({ clipboard }, x) => clipboard.writeText(x), t);
        await pausa(400);
      }
      await cronologiaPronta?.(app).catch?.(() => {});
      const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;background:#202020;height:100vh"><input id="c" value="x" style="position:absolute;left:300px;top:100px;width:300px"></body>');
      await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
      const menu = menuDi(page);
      await page.locator('#c').click({ button: 'right' });
      await expect(menu.principale).toBeVisible();
      await menu.locator('.sn-menu-paste-arrow, .sn-menu-paste-history, [class*="paste"][class*="arrow"]').first().click().catch(() => {});
      await pausa(900);
      const shot = acceso ? menu.superficie : page;
      await shot.screenshot({ path: `tests/.shots/v1054-scuro-cron-${acceso}.png` });
      await page.keyboard.press('Escape');
      await pausa(300);
      await page.mouse.click(700, 400, { button: 'right' });
      await expect(menu.principale).toBeVisible();
      await menu.locator('.sn-menu-row-overflow').hover();
      await pausa(700);
      await shot.screenshot({ path: `tests/.shots/v1054-scuro-griglia-${acceso}.png` });
    });
  });
}
