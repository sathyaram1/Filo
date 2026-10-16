import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');

test('aspetto fidati', async ({ openTab }) => {
  mkdirSync(SHOTS, { recursive: true });
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 10_000 });
  await sec.locator('input[name="cookie-mode"][value="privacy"]').check();
  for (const s of ['https://mail.google.com/mail/u/0/', 'news.bbc.co.uk', 'github.io', 'mail.google.com:443']) {
    await sec.locator('#cookie-wl-input').fill(s);
    await sec.locator('#cookie-wl-input').press('Enter');
  }
  await sec.locator('#cookie-wl-input').fill('mail.google.com');
  await sec.locator('#cookie-wl-input').press('Enter');
  const box = sec.locator('#cookie-wl-list').locator('xpath=ancestor::*[contains(@class,"sn-")][1]');
  console.log('LISTA', await sec.locator('#cookie-wl-list li span').allTextContents());
  console.log('ERR', await sec.locator('#cookie-wl-error').textContent());
  console.log('PLACEHOLDER', await sec.locator('#cookie-wl-input').getAttribute('placeholder'));
  await sec.locator('#cookie-wl-list').scrollIntoViewIfNeeded();
  await sec.screenshot({ path: join(SHOTS, 'v876-chiaro.png') });
  await sec.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'dark' } }));
  await sec.waitForTimeout(800);
  await sec.screenshot({ path: join(SHOTS, 'v876-scuro.png') });
  await sec.locator('#sec-dl-trusted').fill('github.io\nvercel.app');
  await sec.locator('#sec-dl-trusted').press('Tab');
  await expect(sec.locator('#sec-dl-trusted-error')).toBeVisible();
  await sec.locator('#sec-dl-exe-sub').scrollIntoViewIfNeeded();
  await sec.screenshot({ path: join(SHOTS, 'v876-dl-scuro.png') });
});
