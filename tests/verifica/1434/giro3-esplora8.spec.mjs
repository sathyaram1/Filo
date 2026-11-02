// Verifica #1434 giro 3: esplorazione (si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
test('esplora: plaintext-only', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif"><div id="pt" contenteditable="plaintext-only" style="border:1px solid #999;width:300px">Solo testo semplice qui</div></body></html>`);
  await page.locator('#pt').click();
  const p = await page.evaluate(() => {
    const t = document.getElementById('pt').firstChild; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 4);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  console.log('pt fila', JSON.stringify(await menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId))));
  for (const id of ['bold', 'highlight']) {
    const b = menu.locator(`.sn-menu-row [data-sn-icon-id="scrivibile:${id}"]`);
    if (!(await b.count())) break;
    await b.click();
    await page.waitForTimeout(400);
    console.log('pt dopo', id, await page.locator('#pt').innerHTML());
    await page.evaluate(() => {
      const t = document.getElementById('pt').firstChild; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 4);
      getSelection().removeAllRanges(); getSelection().addRange(r);
    });
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(menu.principale).toBeVisible();
  }
});
