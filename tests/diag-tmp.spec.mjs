import { test } from './fixtures/electron.mjs';
test('diag', async ({ openTab, app }) => {
  const page = await openTab('filo://transparency/transparency.html');
  const before = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().map(w => w.getURL()));
  await page.locator('.sn-fonti-list a').first().click();
  await page.waitForTimeout(2000);
  const after = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().map(w => w.getURL()));
  console.log('PRIMA:', JSON.stringify(before));
  console.log('DOPO :', JSON.stringify(after));
});
