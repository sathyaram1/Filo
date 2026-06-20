// TEMP audit exploration — not for commit.
import { test, expect } from './fixtures/electron.mjs';

async function openHistory(app, openTab) {
  const page = await openTab('filo://history/history.html');
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test('history: search with no matches shows which empty message?', async ({ app, openTab }) => {
  const page = await openHistory(app, openTab);

  // Seed two real history items via the page chrome.storage shim, then reload.
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      aiHistory: [
        { action: 'explain', model: 'gemini', timestamp: new Date().toISOString(), input: { selection: 'gatto' }, output: 'Spiegazione del gatto', origin: 'https://example.com' },
        { action: 'help', model: 'gemini', timestamp: new Date().toISOString(), input: { userMessage: 'aiuto' }, output: 'Risposta di aiuto', origin: 'https://example.org' },
      ],
    });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // Items render
  const itemCount = await page.locator('.sn-history-item').count();
  console.log('AUDIT items rendered:', itemCount);
  expect(itemCount).toBe(2);

  // Now search a query that matches nothing.
  await page.fill('#search', 'zzzznomatchqueryxyz');
  await page.waitForTimeout(300);

  const emptyHidden = await page.locator('#empty').evaluate((el) => el.hidden);
  const emptyText = await page.locator('#empty').textContent();
  const visibleItems = await page.locator('.sn-history-item').count();
  console.log('AUDIT after no-match search => emptyHidden:', emptyHidden, '| emptyText:', JSON.stringify(emptyText), '| visibleItems:', visibleItems);

  await page.screenshot({ path: 'tests/.shots/audit-history-search-empty.png' }).catch(() => {});

  // Document the actual behavior (do not fix in audit).
  expect(visibleItems).toBe(0);
});
