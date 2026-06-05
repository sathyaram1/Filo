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
  const popBox = await pop.boundingBox();
  const docBox = await page.locator('#doc').boundingBox();
  console.log('POP box', JSON.stringify(popBox));
  console.log('DOC box', JSON.stringify(docBox));
  // what element is at doc's (5,5) click point?
  const cx = docBox.x + 5, cy = docBox.y + 5;
  const info = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? (el.tagName + '.' + el.className + ' id=' + el.id) : 'none';
  }, [cx, cy]);
  console.log('elementFromPoint at doc(5,5):', info, 'coords', cx, cy);
});
