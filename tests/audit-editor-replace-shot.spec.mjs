import { test } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

test('shot: replace-one corrompe la prima parola', async ({ openTab }) => {
  mkdirSync('tests/.shots', { recursive: true });
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>cat cat cat</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForSelector('.ed-module[data-type="switch"]');
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('.ed-module[data-type="search-replace"]');
  await page.locator('[data-sr="find"]').fill('cat');
  await page.locator('[data-sr="repl"]').fill('cats');
  await page.locator('[data-sr="one"]').click();
  await page.locator('[data-sr="one"]').click();
  await page.locator('[data-sr="one"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/audit-editor-replace-advance.png' });
});
