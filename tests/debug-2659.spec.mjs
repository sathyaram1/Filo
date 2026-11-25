import { test, expect } from './fixtures/electron.mjs';

const pulsante = (id, testo, js) => `<button id="${id}" style="width:200px;height:60px">${testo}</button><script>document.getElementById('${id}').onclick=function(){${js}}</script>`;

test('debug', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>CHAT</title>', { pubblico: true });
  const page = await openTab(testServer.html(`<title>NEGOZIO</title>${pulsante('a', 'Apri', `window.__w=window.open(${JSON.stringify(dest)},'chat')`)}${pulsante('c', 'Chiudi', 'window.__w.close()')}`));
  await page.click('#a');
  await page.waitForTimeout(3000);
  const info = await app.evaluate(({ BrowserWindow, webContents }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    globalThis.__dbg = [];
    const out = tm.tabs.map((t) => { const wc = t.view.webContents; return { id: t.id, wc: wc.id, url: wc.getURL(), adot: !!t._adottataAlle, dl: wc.listenerCount('destroyed') }; });
    for (const t of tm.tabs) { const wc = t.view.webContents; const id = wc.id; for (const ev of ['close', 'destroyed', 'render-process-gone']) wc.on(ev, () => globalThis.__dbg.push(ev + ':' + id + ':' + tm.tabs.includes(t) + ':' + (t.view.webContents === wc))); }
    return { out, all: webContents.getAllWebContents().map((w) => w.id + ' ' + w.getURL()) };
  });
  console.log(JSON.stringify(info, null, 1));
  await app.evaluate(({ BrowserWindow }, u) => { const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs; tm.activate(tm.tabs.find((x) => x.view.webContents.getURL() === u).id); }, page.url());
  await page.click('#c');
  await page.waitForTimeout(3000);
  const dopo = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { dbg: globalThis.__dbg, tabs: tm.tabs.map((t) => ({ id: t.id, haWc: !!t.view.webContents, tipo: typeof t.view.webContents, dist: t.view.webContents && t.view.webContents.isDestroyed() })) };
  });
  console.log(JSON.stringify(dopo, null, 1));
});
