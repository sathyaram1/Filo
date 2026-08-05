import { test } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
const URL = 'filo://board/board.html';
test('shot error + loading', async ({ openTab }) => {
  mkdirSync('tests/.shots', { recursive: true });
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW && window.SN_CHAT_ERRORS, null, { timeout: 15000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20000 });
  await page.evaluate(() => { window.__boardTest.setReleasedVersion('0.2.71'); window.__boardTest.setList(() => Promise.reject(new TypeError('Failed to fetch'))); });
  await page.evaluate(() => window.__boardTest.reload());
  await page.locator('#bdError').waitFor({ state: 'visible' });
  await page.screenshot({ path: 'tests/.shots/board-error-state.png' });
});
