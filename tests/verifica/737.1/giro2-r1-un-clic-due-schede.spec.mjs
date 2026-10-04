import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;
const q = (s) => JSON.stringify(s);

test('un clic vero, lento come quello di una persona, apre una scheda sola anche se la pagina ne chiede una alla pressione e una al rilascio', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<title>A1</title>');
  const b = testServer.html('<title>A2</title>');
  const page = await openTab(testServer.html(`<div id="z" style="width:400px;height:300px;background:#eee">zona</div><script>
    document.addEventListener('mousedown',function(){window.open(${q(a)})});
    document.addEventListener('click',function(){window.open(${q(b)})});</script>`));
  await page.waitForTimeout(5500);
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(2000);
  expect((await aperteSu(app, a)) + (await aperteSu(app, b))).toBe(1);
});
