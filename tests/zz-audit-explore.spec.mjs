import { test, expect } from './fixtures/electron.mjs';

test('audit: editor find/replace edge cases', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  // Type multi-paragraph text with a word, part of which we'll bold.
  await page.click('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>alfa beta alfa</p><p>gamma <strong>al</strong>fa delta</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Open the search-replace module: find its input.
  const findInput = page.locator('[data-sr="find"]');
  await expect(findInput).toBeVisible();

  // Search "alfa": there are 3 visual occurrences, but one ("al"+"fa") is split
  // across a <strong> boundary.
  await findInput.click();
  await findInput.fill('alfa');
  await page.waitForTimeout(300);
  const count = await page.locator('[data-sr="count"]').textContent();
  const hits = await page.locator('#doc mark.ed-find-hit').count();
  console.log('SEARCH alfa -> count display:', JSON.stringify(count), 'marks:', hits);

  // Now replace all "alfa" with "X"
  await page.locator('[data-sr="repl"]').fill('X');
  await page.locator('[data-sr="all"]').click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.getElementById('doc').textContent);
  console.log('AFTER replaceAll:', JSON.stringify(after));

  // Click "Succ" (next) with no active search to see count behavior
  await findInput.fill('');
  await page.waitForTimeout(100);
  await page.locator('[data-sr="next"]').click();
  await page.waitForTimeout(100);
  const countNoSearch = await page.locator('[data-sr="count"]').textContent();
  console.log('NEXT with empty search -> count display:', JSON.stringify(countNoSearch));

  await page.screenshot({ path: 'tests/.shots/audit-editor-sr.png' });
});
