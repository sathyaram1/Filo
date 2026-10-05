// Esplorazione del giro 7 di #737.1: il menu di Filo disegnato sulla pagina e lo schermo intero; la raffica.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;

test('base: senza clic niente scheda e niente schermo intero', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const page = await openTab(testServer.html(`<title>Sito</title><script>window.__fs=[];setTimeout(function(){window.open(${JSON.stringify(ad)});
    document.documentElement.requestFullscreen().then(function(){__fs.push('si')},function(){__fs.push('no')})},1500)</script>`));
  await page.waitForTimeout(3500);
  expect(await aperteSu(app, ad)).toBe(0);
  expect(await page.evaluate(() => [window.__fs, !!document.fullscreenElement])).toEqual([['no'], false]);
});

test('scegliere «Copia URL» nel menu di Filo non lascia alla pagina andare a schermo intero', async ({ openTab, testServer }) => {
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

test('scegliere «Copia URL» nel menu di Filo copia l\'indirizzo, non quello che la pagina scrive al clic', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><a id="l" href="https://example.com/x">collegamento</a>
    <script>document.addEventListener('click',function(){navigator.clipboard.writeText('DELLA PAGINA').catch(function(){})},true)</script></body>`);
  await page.locator('#l').click({ button: 'right', position: { x: 8, y: 8 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(5600);
  await menu.locator('button', { hasText: 'Copia URL' }).first().click();
  await page.waitForTimeout(1500);
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://example.com/x');
});

test('raffica: una pagina che chiede di continuo non passa col clic sul menu di Filo', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><a id="l" href="https://example.com/x">collegamento</a>
    <script>var AD=${JSON.stringify(ad)};setInterval(function(){window.open(AD)},3)</script></body>`);
  await page.waitForTimeout(5600);
  for (let i = 0; i < 4; i++) {
    await page.locator('#l').click({ button: 'right', position: { x: 8, y: 8 } });
    const menu = page.locator('.sn-menu');
    await expect(menu).toBeVisible();
    await page.waitForTimeout(5600);
    await menu.locator('button', { hasText: 'Copia URL' }).first().click();
    await page.waitForTimeout(800);
  }
  expect(await aperteSu(app, ad)).toBe(0);
});
