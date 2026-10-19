// Esplorazione del verificatore (#1054 giro 1): Aiuto e Modifica, e l'aspetto in tema scuro con la cronologia aperta.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function apri(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}
const HTML = '<!doctype html><body style="margin:0;font:16px sans-serif;height:2000px;background:#fff"><input id="c" value="testo campo" style="position:absolute;left:40px;top:40px;width:300px"></body>';

for (const acceso of [false, true]) {
  test.describe(`strato ${acceso ? 'acceso' : 'spento'}`, () => {
    test.use({ stratoDelMenu: acceso });

    test('aiuto, modifica', async ({ app, openTab, testServer, shell }) => {
      test.setTimeout(90_000);
      if (acceso) { await paginaDelloStrato(app); await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true); }
      const page = await apri(openTab, testServer, HTML);
      const menu = menuDi(page);
      const esiti = {};
      await page.locator('#c').click();
      await page.keyboard.press('Control+a');
      await page.locator('#c').click({ button: 'right' });
      await expect(menu.principale).toBeVisible();
      esiti.html = await menu.principale.evaluate((e) => [...e.querySelectorAll('*')].filter((x) => /Modifica|Aiuto/.test(x.textContent) && x.children.length === 0).map((x) => `${x.tagName}.${x.className}|${x.parentElement.className}`));
      await menu.locator('text=Aiuto').first().hover();
      await pausa(700);
      esiti.aiutoSub = await menu.sottomenu.count();
      await menu.locator('text=Modifica').first().hover();
      await pausa(700);
      esiti.modSub = await menu.sottomenu.count();
      esiti.modVoci = esiti.modSub ? await menu.sottomenu.last().evaluate((e) => e.innerText.split('\n').filter(Boolean)) : null;
      await page.screenshot({ path: `tests/.shots/v1054-modifica-${acceso}.png` });
      if (acceso) await menu.superficie.screenshot({ path: `tests/.shots/v1054-modifica-strato.png` });
      await menu.locator('text=Modifica').first().click();
      await pausa(1500);
      esiti.dopoClic = { strato: acceso ? (await statoDelloStrato(app)).aperto : null, menu: await menu.principale.count(), sub: await menu.sottomenu.count(), tabs: await shell.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.textContent.trim().slice(0, 30))) };
      await page.screenshot({ path: `tests/.shots/v1054-modifica-dopo-${acceso}.png` });
      if (acceso) await menu.superficie.screenshot({ path: `tests/.shots/v1054-modifica-dopo-strato.png` });
      console.log(`ESITI4 ${acceso}`, JSON.stringify(esiti, null, 1));
    });
  });
}
