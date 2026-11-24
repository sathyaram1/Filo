// Sonda temporanea #737.13: la pagina chiude la finestra di un altro sito con un pulsante diverso.
import { test, expect } from './fixtures/electron.mjs';

const pulsante = (id, testo, js) => `<button id="${id}" style="width:200px;height:60px">${testo}</button><script>document.getElementById('${id}').onclick=function(){${js}}</script>`;
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.length);

test('sonda chiusura', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>CHAT</title>', { pubblico: true });
  const page = await openTab(testServer.html(`<title>NEGOZIO</title>${pulsante('a', 'Apri', `window.__w=window.open(${JSON.stringify(dest)},'chat')`)}${pulsante('c', 'Chiudi', 'window.__w.close()')}`));
  const n = await schede(app);
  await page.click('#a');
  await expect.poll(() => schede(app), { timeout: 8000 }).toBe(n + 1);
  await page.waitForTimeout(800);
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((x) => x.view.webContents.getURL() === u).id);
    globalThis.__log = [];
    const p = tm.tabs.find((x) => x.view.webContents.getURL().includes('sito-pubblico')).view.webContents;
    globalThis.__p = p;
    const e0 = p.emit;
    p.emit = function (ev, ...a) { globalThis.__log.push(ev); return e0.call(this, ev, ...a); };
  }, page.url());
  await page.click('#c');
  await page.waitForTimeout(3000);
  console.log('schede', n, await schede(app), await page.evaluate(() => window.__w.closed));
  console.log(await app.evaluate(() => { const p = globalThis.__p; let st = {}; try { st = { d: p.isDestroyed(), url: p.getURL(), crashed: p.isCrashed(), mf: !!p.mainFrame, det: p.mainFrame && p.mainFrame.detached, opener: !!p.opener }; } catch (e) { st = { err: e.message }; } return JSON.stringify({ log: globalThis.__log, st }); }));
});
