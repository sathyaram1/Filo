import { test, expect } from './fixtures/electron.mjs';

async function addFontModule(page) {
  await page.locator('.ed-cell-empty').first().click();
  await expect(page.locator('.ed-overlay [data-add="font"]')).toHaveCount(1);
  await page.locator('.ed-overlay [data-add="font"]').click();
  await page.waitForSelector('.ed-module[data-type="font"]');
}

test('diag', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await addFontModule(page);
  const mod = page.locator('.ed-module[data-type="font"]');
  const button = mod.locator('.ed-font-button');
  const pop = mod.locator('.ed-font-pop');

  await button.click();
  await expect(pop).toBeVisible();
  console.log('before doc click hidden=', await pop.evaluate(el => el.hidden));
  await page.locator('#doc').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(50);
  console.log('after doc click hidden=', await pop.evaluate(el => el.hidden));
  console.log('focused after=', await page.evaluate(() => document.activeElement && document.activeElement.className));
});
