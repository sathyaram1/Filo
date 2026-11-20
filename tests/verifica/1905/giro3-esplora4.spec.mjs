// Esplorazione 4 del giro 3 di #1905: la cronologia della scheda dopo un collegamento fra due file della cartella.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const pausa = (app, ms) => app.evaluate((_e, ms) => new Promise((r) => setTimeout(r, ms)), ms);
const storia = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  const h = t.view.webContents.navigationHistory;
  return { id: t.id, url: t.view.webContents.getURL(), n: h.length(), i: h.getActiveIndex(), back: h.canGoBack(), wcId: t.view.webContents.id };
});

test.beforeEach(async ({ app, shell }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoPronta);
});

test('storia', async ({ app, shell, testServer, openTab }) => {
  const dir = cartellaInCasa('filo-1905 storia');
  const html = join(dir, 'a.html');
  writeFileSync(html, '<title>A</title><a id="l" href="b.html">b</a>');
  writeFileSync(join(dir, 'b.html'), '<title>B</title><a id="l" href="a.html">a</a>');
  await execAction(app, { type: 'NAVIGA', url: html }, { parole: [html] });
  await pausa(app, 1500);
  console.log('S0', JSON.stringify(await storia(app)));
  const tab = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    const r = t.view.webContents.getBounds ? null : null;
    return t.id;
  });
  // clic vero col mouse sul collegamento
  await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs.find((x) => x.id === tm.activeId).view.webContents;
    const r = await wc.executeJavaScript('(() => { const b = document.getElementById("l").getBoundingClientRect(); return { x: b.x + 3, y: b.y + 3 }; })()');
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(r.x), y: Math.round(r.y), button: 'left', clickCount: 1 });
  });
  await pausa(app, 1500);
  console.log('S1', JSON.stringify(await storia(app)));
  await shell.evaluate((i) => window.filoShell.tabs.back(i), tab);
  await pausa(app, 1500);
  console.log('S2', JSON.stringify(await storia(app)));

  // confronto con un sito: due pagine dello stesso server
  const p1 = testServer.html('<title>P1</title><a id="l" href="/2">due</a>');
  testServer.html('<title>P2</title>');
  const page = await openTab(p1);
  await page.click('#l');
  await pausa(app, 1000);
  console.log('WEB', JSON.stringify(await storia(app)));
});
