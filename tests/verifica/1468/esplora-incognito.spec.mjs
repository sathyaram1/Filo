// Esplorazione #1468: in incognito né i tasti dei browser né il tasto destro di una pagina contano.

import { test, expect } from '../../fixtures/electron.mjs';

const totale = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  let n = 0;
  for (const ora of Object.values(s.ore || {})) {
    for (const conti of Object.values((ora && ora.strade) || {})) for (const v of Object.values(conti || {})) n += v;
  }
  return n;
});

test('in incognito i tasti e il tasto destro non contano', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<!doctype html><body style="margin:0;height:600px"><a href="https://example.invalid/">link</a> testo</body>', { pubblico: true });
  await openTab('filo://history/history.html');
  const hist = app.windows().find((w) => { try { return w.url().startsWith('filo://history'); } catch (_) { return false; } });
  await hist.evaluate(() => chrome.runtime.sendMessage({ type: 'open_incognito' }));
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs))).toBe(true);
  await new Promise((r) => setTimeout(r, 1500));
  const prima = await totale(app);
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)._filoTabs;
    tm.openTab(u);
  }, url);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return t.view.webContents.executeJavaScript('document.documentElement.dataset.filoReady === "1"');
  }), { timeout: 10000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)._filoTabs;
    const wc = tm.tabs.find((x) => x.id === tm.activeId).view.webContents;
    for (const [kc, mod] of [['J', ['control']], ['D', ['control']], ['F5', []]]) {
      wc.sendInputEvent({ type: 'keyDown', keyCode: kc, modifiers: mod });
      wc.sendInputEvent({ type: 'keyUp', keyCode: kc, modifiers: mod });
    }
    wc.sendInputEvent({ type: 'mouseDown', x: 200, y: 300, button: 'right', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 200, y: 300, button: 'right', clickCount: 1 });
  });
  await new Promise((r) => setTimeout(r, 2000));
  expect(await totale(app)).toBe(prima);
});
