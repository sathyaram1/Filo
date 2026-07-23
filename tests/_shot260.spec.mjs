import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

test('shot260', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  const deadline = Date.now() + 10000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#homeMessage')).toBeVisible({ timeout: 8000 });
  await page.evaluate(async () => {
    const MSG = window.SN_MSG.MSG;
    await new Promise((res) => chrome.runtime.sendMessage({ type: MSG.FILO_ADD_TIMER, label: 'Pasta al forno', seconds: 600 }, res));
  });
  const card = page.locator('.dash-live-card', { hasText: 'Pasta al forno' });
  await expect(card).toBeVisible({ timeout: 8000 });
  mkdirSync('tests/.shots', { recursive: true });
  await card.screenshot({ path: 'tests/.shots/timer-active.png' });
  await card.locator('.dash-live-pause').click();
  await expect(page.locator('.dash-live-card', { hasText: 'Pasta al forno' })).toContainText('(in pausa)', { timeout: 4000 });
  await page.locator('.dash-live-card', { hasText: 'Pasta al forno' }).screenshot({ path: 'tests/.shots/timer-paused.png' });
});
