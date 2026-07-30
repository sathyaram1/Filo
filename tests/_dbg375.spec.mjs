import { test, expect } from './fixtures/electron.mjs';
const URL = 'filo://manage/manage.html';
test('debug reload', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(300);
  await page.evaluate(async () => { await chrome.storage.local.set({ manageUi: { leftW: 99999, rightW: 99999 } }); });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => ({
    cols: document.getElementById('mgReviewGrid').style.gridTemplateColumns,
    list: document.getElementById('mgListCol').getBoundingClientRect().width,
    side: document.getElementById('mgSideCol').getBoundingClientRect().width,
  }));
  console.log('dopo reload con pref assurde:', JSON.stringify(info));
});
