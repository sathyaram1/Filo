import { test, expect } from './fixtures/electron.mjs';

const exec = (app, action) =>
  app.evaluate((_e, { action }) => globalThis.SN_EXECUTE_FILO_ACTION(action), { action });

const snap = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  const tabs = win._filoTabs;
  const active = tabs.tabs.find((t) => t.id === tabs.activeId);
  const b = active.view.getBounds();
  const [ww, wh] = win.getContentSize();
  return { x: b.x, y: b.y, w: b.width, h: b.height, ww, wh, fs: tabs.contentFullscreen,
           shellHeight: tabs.shellHeight, tabRowHeight: tabs.tabRowHeight, compact: tabs.chromeCompact };
});

test('probe: bounds nel tempo attorno al toggle', async ({ app, openTab, testServer }) => {
  await openTab(testServer.html('<!doctype html><title>p</title><body>x</body>'));
  console.log('INIT   ', JSON.stringify(await snap(app)));

  await exec(app, { type: 'COMANDO_FINESTRA', comando: 'fullscreen' });
  await new Promise((r) => setTimeout(r, 1500));
  console.log('FS ON  ', JSON.stringify(await snap(app)));

  await exec(app, { type: 'COMANDO_FINESTRA', comando: 'fullscreen' });
  await new Promise((r) => setTimeout(r, 2500));
  console.log('FS OFF ', JSON.stringify(await snap(app)));

  // e dopo un resize forzato della finestra?
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const [w, h] = win.getContentSize();
    win.setContentSize(w, h - 1);
  });
  await new Promise((r) => setTimeout(r, 1200));
  console.log('RESIZE ', JSON.stringify(await snap(app)));

  expect(true).toBe(true);
});

test('probe: stesso toggle dal MENU TASTO DESTRO (percorso preesistente)', async ({ app, openTab, testServer }) => {
  await openTab(testServer.html('<!doctype html><title>p</title><body>x</body>'));
  console.log('INIT   ', JSON.stringify(await snap(app)));

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 1500));
  console.log('FS ON  ', JSON.stringify(await snap(app)));

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.setContentFullscreen(false);
  });
  await new Promise((r) => setTimeout(r, 2500));
  console.log('FS OFF ', JSON.stringify(await snap(app)));

  expect(true).toBe(true);
});
