// #737.1 giro 7: ciò che l'utente fa sul menu di Filo disegnato sulla pagina non è un gesto per la pagina, né per lo
// schermo intero né per la pagina che chiede schede di continuo.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;

test('scegliere «Copia URL» nel menu di Filo non lascia alla pagina andare a schermo intero', async ({ openTab, testServer }) => {
  test.fail(true, '#737.1: Il menu di Filo disegnato sulla pagina vale ancora come gesto della pagina: sempre per lo schermo intero, e per le schede quando la pagina le chiede di continuo.');
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
