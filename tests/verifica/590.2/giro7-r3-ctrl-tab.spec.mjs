// #590.2 giro 7 — Ctrl+Tab porta alla scheda dopo, come in ogni browser.
import { test, expect } from '../../fixtures/electron.mjs';

test('Ctrl+Tab passa alla scheda successiva', async ({ app, shell, openTab, testServer }) => {
  const p1 = await openTab(testServer.html('<!doctype html><textarea id="t"></textarea>'));
  await p1.waitForSelector('#t');
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const prima = snap.activeId;
  const idx = snap.tabs.findIndex((t) => t.id === prima);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), snap.tabs[0].id === prima ? snap.tabs[1].id : snap.tabs[0].id);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), prima);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tab = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    tab.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] });
    tab.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['control'] });
    tab.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['control'] });
    tab.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Control', modifiers: [] });
  });
  const attesa = snap.tabs[(idx + 1) % snap.tabs.length].id;
  await expect.poll(async () => (await shell.evaluate(() => window.filoShell.tabs.snapshot())).activeId, { timeout: 2000 }).toBe(attesa);
});
