// TEMP audit exploration — not for commit.
import { test, expect } from './fixtures/electron.mjs';

test('editor: edge inputs, watch console errors', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.waitForTimeout(800);

  // Type into the doc with edge cases.
  const doc = page.locator('#doc');
  if (await doc.count()) {
    await doc.click().catch(() => {});
    const longWord = 'a'.repeat(500);
    await page.keyboard.type('riga uno\n').catch(() => {});
    await page.keyboard.type(longWord).catch(() => {});
    await page.waitForTimeout(400);
  }

  // Font search with a query that matches nothing.
  const fontSearch = page.locator('input[placeholder="Cerca un font…"]');
  console.log('AUDIT fontSearch present:', await fontSearch.count());

  await page.waitForTimeout(300);
  console.log('AUDIT editor console errors:', JSON.stringify(errors.slice(0, 15)));
  await page.screenshot({ path: 'tests/.shots/audit-editor.png' }).catch(() => {});
});
