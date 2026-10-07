// #737.1 giro 7: ciò che l'utente fa sul menu di Filo disegnato sulla pagina non è un gesto per la pagina, né per lo
// schermo intero né per la pagina che chiede schede di continuo.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;

test('scegliere «Copia URL» nel menu di Filo non lascia alla pagina andare a schermo intero', async ({ openTab, testServer }) => {
  test.fail(true, '#737.1: lo schermo intero dal menu di Filo l\'owner l\'ha accettato (si esce con Esc; lo chiude il menu fuori dalla pagina, D14).');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><a id="l" href="https://example.com/x">collegamento</a>
    <script>window.__fs=[];document.addEventListener('click',function(){document.documentElement.requestFullscreen().then(function(){__fs.push('si')},function(){__fs.push('no')})},true)</script></body>`);
  await page.locator('#l').click({ button: 'right', position: { x: 8, y: 8 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(5600);
  await menu.locator('button', { hasText: 'Copia URL' }).first().click();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => [window.__fs, !!document.fullscreenElement]), 'il clic sul menu di Filo non è della pagina').toEqual([['no'], false]);
});

test('raffica: una pagina che chiede di continuo non passa col clic sul menu di Filo', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><a id="l" href="https://example.com/x">collegamento</a>
    <script>var AD=${JSON.stringify(ad)};setInterval(function(){window.open(AD)},3)</script></body>`);
  await page.waitForTimeout(5600);
  const passate = [];
  for (let i = 0; i < 4; i++) {
    await page.locator('#l').click({ button: 'right', position: { x: 8, y: 8 } });
    const menu = page.locator('.sn-menu');
    await expect(menu).toBeVisible();
    await page.waitForTimeout(5600);
    const prima = await aperteSu(app, ad);
    await menu.locator('button', { hasText: 'Copia URL' }).first().click();
    await page.waitForTimeout(800);
    passate.push((await aperteSu(app, ad)) - prima);
  }
  expect(passate).toEqual([0, 0, 0, 0]);
});
