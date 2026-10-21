import { test, expect } from '../../fixtures/electron.mjs';

test('setSize applica', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1100, 700); });
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  const info = async () => ({
    win: await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { s: w.getSize(), c: w.getContentSize(), max: w.isMaximized(), n: BrowserWindow.getAllWindows().length }; }),
    vp: await ed.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]),
  });
  console.log('A', JSON.stringify(await info()));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1400, 760); });
  await ed.waitForTimeout(1500);
  console.log('B', JSON.stringify(await info()));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1300, 700); });
  await ed.waitForTimeout(1500);
  console.log('C', JSON.stringify(await info()));
});
