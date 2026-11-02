// Esplorazione #1434 giro 1: aspetto della fila in tema chiaro e scuro, Incolla nella casella, Apri link.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p>
  <img id="foto" src="${img}" width="160" height="120" alt="foto">
  <p><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
  <input id="campo" value="ciao mondo" style="width:300px">
  </body></html>`;

async function selezionaTesto(page, sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = document.createRange();
    r.selectNodeContents(el.firstChild || el);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  }, sel);
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, openTab, testServer }) => {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    const img = testServer.asset(PNG, 'image/png');
    const page = await testServer.openReady(openTab, SITO(img));
    await selezionaTesto(page, '#testo');
    const r = await page.locator('#testo').boundingBox();
    await page.mouse.click(r.x + 30, r.y + r.height / 2, { button: 'right' });
    const menu = menuDi(page);
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    await page.waitForTimeout(500);
    await menu.principale.screenshot({ path: `tests/.shots/1434-testo-${tema}.png` });
    await menu.locator('.sn-menu-row .sn-menu-row-overflow').click();
    await expect(menu.locator('.sn-menu-icon-grid')).toBeVisible();
    await page.waitForTimeout(400);
    await menu.superficie.screenshot({ path: `tests/.shots/1434-testo-piu-${tema}.png` });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('#foto').click({ button: 'right' });
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    await page.waitForTimeout(500);
    await menu.principale.screenshot({ path: `tests/.shots/1434-immagine-${tema}.png` });
    await page.keyboard.press('Escape');
    await page.locator('#vai').click({ button: 'right' });
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    await page.waitForTimeout(500);
    await menu.principale.screenshot({ path: `tests/.shots/1434-link-${tema}.png` });
    await page.keyboard.press('Escape');
  });
}

test('casella: taglia e incolla dalla fila', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO('/x.png'));
  await page.locator('#campo').click();
  await page.evaluate(() => { const c = document.getElementById('campo'); c.focus(); c.setSelectionRange(0, 4); });
  await page.locator('#campo').click({ button: 'right', position: { x: 15, y: 8 } });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  const ids = await menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((e) => e.map((x) => x.dataset.snIconId));
  console.log('IDS campo', ids);
  await menu.locator('.sn-menu-row [data-sn-icon-id="campo:cut"]').click();
  await expect.poll(() => page.locator('#campo').inputValue()).toBe(' mondo');
  await page.evaluate(() => { const c = document.getElementById('campo'); c.focus(); c.setSelectionRange(6, 6); });
  await page.evaluate(() => { const c = document.getElementById('campo'); c.setSelectionRange(1, 6); });
  await page.locator('#campo').click({ button: 'right', position: { x: 30, y: 8 } });
  await expect(menu.locator('.sn-menu-row')).toBeVisible();
  await menu.locator('.sn-menu-row [data-sn-icon-id="campo:paste"]').click();
  await expect.poll(() => page.locator('#campo').inputValue()).toBe(' ciao');
});
