import { test, expect } from '../../fixtures/electron.mjs';
test('sonda blur main', async ({ app, openTab }) => {
  const altro = await openTab('filo://options/altro.html');
  await altro.waitForSelector('#blocklist', { timeout: 8000 });
  await altro.locator('#blocklist').click();
  console.log(await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const out = [];
    t.view.webContents.on('blur', () => out.push('page blur'));
    t.view.webContents.on('focus', () => out.push('page focus'));
    w.webContents.on('focus', () => out.push('shell focus'));
    t.view.webContents.focus();
    await new Promise((r) => setTimeout(r, 200));
    out.push('page focused=' + t.view.webContents.isFocused());
    w.webContents.focus();
    await new Promise((r) => setTimeout(r, 300));
    out.push('page focused=' + t.view.webContents.isFocused() + ' shell=' + w.webContents.isFocused());
    return out.join(' | ');
  }));
});
