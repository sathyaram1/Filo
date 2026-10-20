// Esplorazione del verificatore (#1054 giro 1): le freccette ▸ (Detta, la riga d'avviso) aprono i loro pannelli.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

for (const acceso of [false, true]) {
  test.describe(`strato ${acceso ? 'acceso' : 'spento'}`, () => {
    test.use({ stratoDelMenu: acceso });
    test('freccette', async ({ app, openTab, testServer }) => {
      test.setTimeout(90_000);
      if (acceso) { await paginaDelloStrato(app); await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true); }
      const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;height:100vh"><input id="c" value="testo campo" style="position:absolute;left:40px;top:40px;width:300px"></body>');
      await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
      const menu = menuDi(page);
      await page.locator('#c').click();
      await page.keyboard.press('Control+a');
      await page.locator('#c').click({ button: 'right' });
      await expect(menu.principale).toBeVisible();
      await pausa(500);
      const frecce = await menu.principale.evaluate((root) => [...root.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim() === '▸' && e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, cls: e.className, padre: e.parentElement.className }; }));
      const esiti = [];
      for (const f of frecce) {
        const mouse = menu.superficie.mouse || page.mouse;
        await mouse.click(f.x, f.y);
        await pausa(900);
        esiti.push({ f: `${f.cls}|${f.padre}`, pannelli: await menu.pannelli.count(), testi: await menu.pannelli.evaluateAll((ps) => ps.slice(1).map((p) => p.innerText.slice(0, 120))), aperto: await menu.principale.count() });
        if (!(await menu.principale.count())) {
          await page.locator('#c').click({ button: 'right' });
          await expect(menu.principale).toBeVisible();
          await pausa(400);
        }
      }
      await page.screenshot({ path: `tests/.shots/v1054-frecce-${acceso}.png` });
      if (acceso) await menu.superficie.screenshot({ path: 'tests/.shots/v1054-frecce-strato.png' });
      console.log(`FRECCE ${acceso}`, JSON.stringify(esiti, null, 1));
    });
  });
}
