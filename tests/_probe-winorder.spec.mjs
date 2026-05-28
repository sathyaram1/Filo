import { test, expect } from './fixtures/electron.mjs';

test('probe getAllWindows order with a child window', async ({ app, shell }) => {
  await shell.waitForLoadState('domcontentloaded');
  const result = await app.evaluate(async ({ BrowserWindow }) => {
    const before = BrowserWindow.getAllWindows().map((w) => ({
      hasTabs: !!w._filoTabs,
      title: w.getTitle(),
    }));
    const main = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    // Simulate the reused tooltip / popup child window.
    const child = new BrowserWindow({
      parent: main,
      show: false,
      focusable: false,
    });
    const after = BrowserWindow.getAllWindows().map((w) => ({
      hasTabs: !!w._filoTabs,
    }));
    const zeroHasTabs = !!BrowserWindow.getAllWindows()[0]._filoTabs;
    return { before, after, zeroHasTabs };
  });
  console.log('PROBE_RESULT', JSON.stringify(result));
  expect(true).toBe(true);
});
