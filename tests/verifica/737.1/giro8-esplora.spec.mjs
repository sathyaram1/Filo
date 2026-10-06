// #737.1 giro 8: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;
const q = (s) => JSON.stringify(s).replace(/"/g, '&quot;');

test('srcdoc: il link con target _blank in un riquadro srcdoc si apre col clic', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>SRCDOC</title>');
  const page = await openTab(testServer.html(`<iframe id="f" width="400" height="200" srcdoc="<a id=l href='${dest}' target=_blank style='display:block;width:200px;height:60px'>link</a>"></iframe>`));
  await page.waitForTimeout(1500);
  const fr = page.frames().find((f) => f !== page.mainFrame());
  await fr.click('#l');
  await expect.poll(() => aperteSu(app, dest), { timeout: 8000 }).toBe(1);
});

test('about:blank scritto dalla pagina: il pulsante dentro apre col clic', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>BLANK</title>');
  const page = await openTab(testServer.html(`<iframe id="f" width="400" height="200"></iframe><script>
    var d=document.getElementById('f').contentDocument;d.open();d.write('<button id=b style="width:200px;height:60px" onclick="window.open(${q(dest).replace(/&quot;/g, "\\'")})">apri</button>');d.close();</script>`));
  await page.waitForTimeout(1500);
  const fr = page.frames().find((f) => f !== page.mainFrame());
  await fr.click('#b');
  await expect.poll(() => aperteSu(app, dest), { timeout: 8000 }).toBe(1);
});

test('riquadro sandbox con allow-popups di un altro sito: il clic apre', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>SANDBOX</title>');
  const dentro = testServer.html(`<button id="b" style="width:200px;height:60px" onclick="window.open(${q(dest)})">apri</button>`, { pubblico: true });
  const page = await openTab(testServer.html(`<iframe sandbox="allow-scripts allow-popups" src="${dentro}" width="400" height="200"></iframe>`));
  await expect.poll(() => page.frames().some((f) => f.url() === dentro), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(800);
  await page.frames().find((f) => f.url() === dentro).click('#b');
  await expect.poll(() => aperteSu(app, dest), { timeout: 8000 }).toBe(1);
});

test('apertura dopo un secondo e mezzo dal clic (fetch prima)', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>DOPO</title>');
  const page = await openTab(testServer.html(`<button id="b" style="width:200px;height:60px" onclick="setTimeout(function(){window.open(${q(dest)})},1500)">apri</button>`));
  await page.waitForTimeout(800);
  await page.click('#b');
  await expect.poll(() => aperteSu(app, dest), { timeout: 8000 }).toBe(1);
});

test('Invio su un link con target _blank lo apre', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>INVIO</title>');
  const page = await openTab(testServer.html(`<a id="l" href="${dest}" target="_blank">link</a>`));
  await page.waitForTimeout(800);
  await page.focus('#l');
  await page.waitForTimeout(5600);
  await page.keyboard.press('Enter');
  await expect.poll(() => aperteSu(app, dest), { timeout: 8000 }).toBe(1);
});

test('mailto con il riquadro: la pagina che apre da sola un riquadro senza clic', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>TIMER</title>');
  const page = await openTab(testServer.html(`<p>x</p><script>setTimeout(function(){window.open(${JSON.stringify(dest)})},3000);setTimeout(function(){document.documentElement.requestFullscreen().then(function(){window.__fs='si'},function(){window.__fs='no'})},3000)</script>`));
  await page.waitForTimeout(4500);
  expect(await aperteSu(app, dest)).toBe(0);
  expect(await page.evaluate(() => [window.__fs || 'pending', !!document.fullscreenElement])).toEqual(['no', false]);
});
