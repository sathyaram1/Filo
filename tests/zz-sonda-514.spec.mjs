// Sonda usa e getta: capire DOVE arriva il tasto Esc.
import { test, expect } from './fixtures/electron.mjs';

async function sonda(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__p = { shell: [], views: [] };
    win.webContents.on('before-input-event', (e, i) => {
      if (i.type === 'keyDown') globalThis.__p.shell.push(String(i.key));
    });
    win._filoTabs.tabs.forEach((t) => {
      t.view.webContents.on('before-input-event', (e, i) => {
        if (i.type === 'keyDown') globalThis.__p.views.push(`${t.id}:${i.key}`);
      });
    });
    return true;
  });
}

async function leggi(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = win._filoTabs;
    const active = t.tabs.find((x) => x.id === t.activeId);
    return {
      p: globalThis.__p,
      cf: t.contentFullscreen,
      pf: t.pageFullscreen,
      pfTab: t.pageFullscreenTabId,
      activeId: t.activeId,
      compact: t.chromeCompact,
      topInset: t.topInset,
      y: active ? active.view.getBounds().y : null,
      shellHeight: t.shellHeight,
      tabRow: t.tabRowHeight,
      os: win.isFullScreen(),
    };
  });
}

test('sonda A — dove arriva Esc dalla shell e dalla pagina', async ({ app, shell, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, '<html><body><h1>x</h1></body></html>');
  await sonda(app);
  console.log('PRIMA', JSON.stringify(await leggi(app)));
  await shell.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  console.log('DOPO ESC SHELL (fuori fullscreen)', JSON.stringify(await leggi(app)));

  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 600));
  console.log('IN FULLSCREEN', JSON.stringify(await leggi(app)));
  await shell.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 800));
  console.log('DOPO ESC SHELL (in fullscreen)', JSON.stringify(await leggi(app)));

  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 800));
  console.log('DOPO ESC PAGINA', JSON.stringify(await leggi(app)));
  expect(true).toBe(true);
});

test('sonda B — schermo pieno chiesto dal sito', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><button id="b" style="width:300px;height:120px">fs</button>'
    + '<script>document.getElementById("b").onclick=()=>document.documentElement.requestFullscreen()</script></body></html>',
  );
  await sonda(app);
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1500));
  console.log('DOPO CLICK FS', JSON.stringify(await leggi(app)));
  console.log('fullscreenElement:', await page.evaluate(() => !!document.fullscreenElement));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 1500));
  console.log('DOPO ESC', JSON.stringify(await leggi(app)));
  console.log('fullscreenElement:', await page.evaluate(() => !!document.fullscreenElement));
  expect(true).toBe(true);
});
