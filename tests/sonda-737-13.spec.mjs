// Sonda temporanea #737.13: cosa vede il main quando la pagina chiede il focus della finestra di un altro sito.
import { test, expect } from './fixtures/electron.mjs';

const pulsante = (id, testo, js) => `<button id="${id}" style="width:200px;height:60px">${testo}</button><script>document.getElementById('${id}').onclick=function(){${js}}</script>`;

test('sonda', async ({ app, openTab, testServer }) => {
  const aiuto = testServer.html('<title>AIUTO</title><script>addEventListener("focus",function(){document.title="AIUTO F"})</script>', { pubblico: true });
  const page = await openTab(testServer.html(`<title>ELENCO</title><script>var w=null;function apri(){if(w&&!w.closed)w.focus();else w=window.open(${JSON.stringify(aiuto)},'aiuto');}</script>
    ${pulsante('a', 'aiuto', 'apri()')}${pulsante('b', 'aiuto di nuovo', 'apri()')}`));
  await page.click('#a');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.some((t) => t.view.webContents.getURL().includes('sito-pubblico'))), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(800);
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((x) => x.view.webContents.getURL() === u).id);
    globalThis.__log = [];
    for (const t of tm.tabs) {
      const wc = t.view.webContents;
      const nome = wc.getURL().includes('sito-pubblico') ? 'popup' : (wc.getURL() === u ? 'opener' : 'altro');
      const e0 = wc.emit;
      wc.emit = function (ev, ...a) { if (!['console-message', 'ipc-message', '-ipc-message', 'cursor-changed'].includes(ev)) globalThis.__log.push(`${nome}:${ev}`); return e0.call(this, ev, ...a); };
      try { globalThis.__log.push(`${nome}:focusedFrame=${wc.focusedFrame && wc.focusedFrame.url}`); } catch (e) { globalThis.__log.push('ff err ' + e.message); }
    }
  }, page.url());
  await page.waitForTimeout(500);
  await page.click('#b');
  await page.waitForTimeout(1500);
  const log = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    for (const t of tm.tabs) { try { globalThis.__log.push(`dopo:${t.view.webContents.getURL()} ff=${t.view.webContents.focusedFrame && t.view.webContents.focusedFrame.url} attiva=${t.id === tm.activeId} titolo=${t.view.webContents.getTitle()}`); } catch (_) {} }
    return globalThis.__log;
  });
  console.log(JSON.stringify(log, null, 1));
});
