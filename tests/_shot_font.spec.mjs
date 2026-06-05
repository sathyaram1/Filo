import { test } from './fixtures/electron.mjs';

test('shot font picker', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await page.locator('.ed-cell-empty').first().click();
  await page.locator('.ed-overlay [data-add="font"]').click();
  await page.waitForSelector('.ed-module[data-type="font"]');
  const mod = page.locator('.ed-module[data-type="font"]');
  await mod.locator('.ed-font-button').click();
  await page.waitForTimeout(200);
  await mod.locator('.ed-font-search').fill('ga');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'tests/.shots/font-search.png', clip: { x: 0, y: 0, width: 700, height: 520 } });
  await mod.locator('.ed-font-search').fill('');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'tests/.shots/font-all.png', clip: { x: 0, y: 0, width: 700, height: 520 } });
});
