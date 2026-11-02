// Verifica #1434 giro 3: esplorazione (si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
test('esplora: sola lettura, email, numero', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
    <textarea id="ro" readonly style="display:block;width:300px">testo in sola lettura</textarea>
    <input id="em" type="email" value="nome@esempio.it" style="display:block;width:300px;margin-top:20px">
    <input id="nu" type="number" value="123456" style="display:block;width:300px;margin-top:20px">
    <div id="ri" contenteditable="false" style="margin-top:20px">non scrivibile</div>
  </body></html>`);
  const menu = menuDi(page);
  for (const id of ['#ro', '#em', '#nu']) {
    await page.locator(id).click();
    await page.locator(id).evaluate((e) => { e.focus(); e.select(); });
    const b = await page.locator(id).boundingBox();
    await page.mouse.click(b.x + 12, b.y + b.height / 2, { button: 'right' });
    await expect(menu.principale).toBeVisible();
    console.log(id, 'fila', JSON.stringify(await menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId))), 'voci', JSON.stringify(await menu.voci.allTextContents()));
    const cut = menu.locator('.sn-menu-row [data-sn-icon-id="campo:cut"]');
    if (await cut.count()) {
      await app.evaluate(({ clipboard }) => clipboard.writeText('VUOTO'));
      await cut.click();
      await page.waitForTimeout(400);
      console.log(id, 'dopo taglia', JSON.stringify(await page.locator(id).inputValue()), 'appunti', await app.evaluate(({ clipboard }) => clipboard.readText()));
    } else await page.keyboard.press('Escape');
  }
});
