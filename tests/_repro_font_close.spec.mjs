import { test, expect } from './fixtures/electron.mjs';

test('repro: font dropdown closes on various outside clicks', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await page.locator('.ed-cell-empty').first().click();
  await page.locator('.ed-overlay [data-add="font"]').click();
  await page.waitForSelector('.ed-module[data-type="font"]');

  const mod = page.locator('.ed-module[data-type="font"]');
  const button = mod.locator('.ed-font-button');
  const pop = mod.locator('.ed-font-pop');

  // target 1: the document
  await button.click();
  expect(await pop.evaluate(el => el.hidden)).toBe(false);
  await page.locator('#doc').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(100);
  console.log('doc:', await pop.evaluate(el => el.hidden));

  // target 2: the topbar
  await button.click();
  expect(await pop.evaluate(el => el.hidden)).toBe(false);
  await page.locator('.ed-topbar').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(100);
  console.log('topbar:', await pop.evaluate(el => el.hidden));

  // target 3: body coordinate far away
  await button.click();
  expect(await pop.evaluate(el => el.hidden)).toBe(false);
  await page.mouse.click(2, 2);
  await page.waitForTimeout(100);
  console.log('corner:', await pop.evaluate(el => el.hidden));
});
