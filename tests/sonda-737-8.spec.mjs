import { test, expect } from './fixtures/electron.mjs';

test('sonda', async ({ app, shell, openTab, testServer }) => {
  const uno = testServer.html('<title>UNO</title><p id="x">uno</p>');
  const page = await openTab(testServer.html(`<script>var w=null;</script>
    <button id="a" style="height:40px" onclick="w=window.open(${JSON.stringify(uno).replace(/"/g, '&quot;')},'aiuto')">apri</button>
    <button id="f" style="height:40px" onclick="w.focus()">focus</button>
    <button id="v" style="height:40px" onclick="window.open('','aiuto')">vuoto</button>
    <button id="h" style="height:40px" onclick="window.open(${JSON.stringify(uno + '#x').replace(/"/g, '&quot;')},'aiuto')">ancora</button>`));
  await page.click('#a');
  await page.waitForTimeout(1500);
  await app.evaluate(({ BrowserWindow, webContents }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    globalThis.__log = [];
    const t = tm.tabs.find((x) => x.view.webContents.getURL().endsWith('/1'));
    const wc = t.view.webContents;
    for (const ev of ['focus', 'blur', 'did-start-navigation', 'did-navigate-in-page', 'activate', 'frame-created']) {
      wc.on(ev, (e) => globalThis.__log.push(ev + ' ' + (e && e.initiator ? 'init' : '') + ' ' + (e && e.isSameDocument)));
    }
    const ipc = wc.ipc;
    tm.activate(tm.tabs.find((x) => x.view.webContents.getURL().endsWith('/2')).id);
  });
  await page.waitForTimeout(800);
  for (const b of ['#f', '#v', '#h']) {
    await app.evaluate(() => globalThis.__log.push('---'));
    await page.click(b);
    await page.waitForTimeout(1000);
  }
  console.log(await app.evaluate(() => globalThis.__log.join('\n')));
});
