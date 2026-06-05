import { test, expect } from './fixtures/electron.mjs';

test('repro: font dropdown closes on outside click', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await page.locator('.ed-cell-empty').first().click();
  await page.locator('.ed-overlay [data-add="font"]').click();
  await page.waitForSelector('.ed-module[data-type="font"]');

  const mod = page.locator('.ed-module[data-type="font"]');
  const button = mod.locator('.ed-font-button');
  await button.click();
  const pop = mod.locator('.ed-font-pop');
  console.log('after open hidden=', await pop.evaluate(el => el.hidden));

  // Click on the document area (outside the dropdown)
  await page.locator('#doc').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(200);
  console.log('after outside click hidden=', await pop.evaluate(el => el.hidden));
});
