// Verifica #1434 giro 3: esplorazione (si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
test('esplora: riquadro dopo un clic', async ({ openTab, testServer }) => {
  const sub = testServer.html('<!doctype html><html><body><div id=ce contenteditable=true style="font:16px sans-serif">Testo nel riquadro</div></body></html>');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px"><iframe id="fs" src="${sub}" style="width:400px;height:60px"></iframe></body></html>`);
  await page.waitForTimeout(1000);
  const box = await page.locator('#fs').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 15);
  await page.waitForTimeout(1500);
  const f = await (await page.locator('#fs').elementHandle()).contentFrame();
  const q = await f.evaluate(() => {
    const el = document.getElementById('ce');
    const t = el.firstChild; const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 5);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  const menu = menuDi(f);
  for (let giro = 0; giro < 2; giro++) {
    await page.mouse.click(box.x + q.x, box.y + q.y, { button: 'right' }); await page.waitForTimeout(800); await page.screenshot({ path: 'tests/.shots/1434-g3/riquadro.png' });
    await page.waitForTimeout(1500);
    const n = await menu.principale.count();
    console.log('giro', giro, 'menu', n, 'nel riquadro', await f.locator('.sn-menu').count(), 'popup', page.context().pages().filter((x) => x.url().startsWith('data:')).length, 'strati', await Promise.all(page.context().pages().filter((x) => x.url().startsWith('filo://menu')).map((x) => x.locator('.sn-menu').count())), n ? JSON.stringify(await menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId))) : '');
    if (n) {
      await menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:bold"]').click();
      await page.waitForTimeout(400);
      console.log('dopo', await f.evaluate(() => document.getElementById('ce').innerHTML));
      break;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
});
