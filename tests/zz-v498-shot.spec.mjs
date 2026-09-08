import { test, expect } from './fixtures/electron.mjs';
const URL = 'filo://manage/manage.html';
test('shot', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => {
    const reqs = Array.from({ length: 4 }, (_, i) => ({
      id: `r${i}`, branch: `claude/ramo-${i}`, sha: 'abcdef0123456789', who: `routine-${i}`,
      origin: 'routine', feedbackNum: `#${400 + i}`,
      createdAtMs: Date.now() - 3600000, expiresAtMs: Date.now() + 6 * 86400000,
      blocks: [{ kind: 'protected-paths', items: ['package.json'] }],
    }));
    window.SN_MERGE_APPROVALS.render(document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/v498-finale-scuro.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('#mgSearchToggle').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v498-finale-ricerca.png' });
  expect(true).toBe(true);
});
