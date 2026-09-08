import { test, expect } from './fixtures/electron.mjs';

function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    return {
      contentFullscreen: tabs.contentFullscreen,
      pageFullscreen: tabs.pageFullscreen,
      pageFullscreenTabId: tabs.pageFullscreenTabId,
      activeId: tabs.activeId,
      urls: tabs.tabs.map((t) => ({ id: t.id, url: t.url })),
      hits: win._escHits || 0,
    };
  });
}

test('dbg shell esc', async ({ app, shell, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => !!(window.chrome && chrome.runtime && chrome.runtime.sendMessage), null, { timeout: 8000 });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'toggle_fullscreen' }));
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._escHits = 0;
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown') win._escHits = (win._escHits || 0) + 1;
    });
    win.webContents.focus();
  });
  await shell.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 1500));
  console.log('DBG1', JSON.stringify(await stato(app)));
});

test('dbg altra scheda', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<html><body style="margin:0"><div id="box" style="width:100px;height:100px;background:#09f"></div></body></html>');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    return active.view.webContents.executeJavaScript('document.getElementById("box").requestFullscreen().catch(()=>{}); true', true);
  });
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(true);
  console.log('DBG2-prima', JSON.stringify(await stato(app)));
  const altra = await openTab('filo://editor/editor.html');
  await altra.waitForLoadState('domcontentloaded').catch(() => {});
  console.log('DBG2-dopo-apertura', JSON.stringify(await stato(app)));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    try { active.view.webContents.focus(); } catch (_) {}
  });
  await altra.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 1500));
  console.log('DBG2-dopo-esc', JSON.stringify(await stato(app)));
});
