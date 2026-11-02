// Verifica #1434 giro 3: esplorazione (si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SITO = `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <p id="testo">Un paragrafo di prova da selezionare.</p>
  </body></html>`;
const ids = (menu) => menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId));
const fermo = async (loc) => { await expect(loc).toBeVisible(); await loc.page?.().waitForTimeout?.(200); return loc.boundingBox(); };

test('esplora: dalla fila al «+»', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const menu = menuDi(page);
  await page.evaluate(() => {
    const r = document.createRange(); r.selectNodeContents(document.getElementById('testo').firstChild);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  const b = await page.locator('#testo').boundingBox();
  await page.mouse.click(b.x + 30, b.y + b.height / 2, { button: 'right' });
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  await page.waitForTimeout(400);
  const da = await fermo(menu.locator('.sn-menu-row [data-sn-icon-id="testo:search"]'));
  const piu = await fermo(menu.locator('.sn-menu-row .sn-menu-row-overflow'));
  await page.mouse.move(da.x + da.width / 2, da.y + da.height / 2);
  await page.mouse.down();
  await page.mouse.move(da.x + 10, da.y + 10, { steps: 3 });
  await page.mouse.move(piu.x + piu.width / 2, piu.y + piu.height / 2, { steps: 8 });
  await page.waitForTimeout(900);
  console.log('griglia aperta durante il trascinamento', await menu.locator('.sn-menu-icon-grid').count());
  const g = menu.locator('.sn-menu-icon-grid');
  if (await g.count()) {
    const gb = await g.boundingBox();
    await page.mouse.move(gb.x + gb.width - 10, gb.y + gb.height / 2, { steps: 8 });
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
  console.log('fila dopo', JSON.stringify(await ids(menu)), 'menu', await menu.principale.count());
  await menu.superficie.screenshot({ path: 'tests/.shots/1434-g3/fila-al-piu.png' });
});
