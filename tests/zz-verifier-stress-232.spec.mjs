import { test, expect } from './fixtures/electron.mjs';

const storedAA = (page) => page.evaluate(async () => {
  const r = await chrome.storage.local.get('settings');
  return (r && r.settings && r.settings.autoArchive) || {};
});
const storedN = (page) => page.evaluate(async () => {
  const r = await chrome.storage.local.get('settings');
  return (r && r.settings && r.settings.notifications) || {};
});

// Only numeric strings — a type=number input rejects non-numeric text at the
// browser level, so "abc"/whitespace can never reach these fields.
test('stress idleHours: empty/decimal/huge/zero/negative', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#autoArchiveIdleHours');
  for (const [input, expectedShown] of [['', '6'], ['5.7', '5'], ['1000000', '168'], ['0', '6'], ['-3', '6'], ['168', '168'], ['1', '1']]) {
    await page.fill('#autoArchiveIdleHours', input);
    await page.locator('#autoArchiveIdleHours').blur();
    await expect(page.locator('#autoArchiveIdleHours')).toHaveValue(expectedShown);
    const shown = await page.locator('#autoArchiveIdleHours').inputValue();
    expect(await storedAA(page).then(a => String(a.idleHours))).toBe(shown);
  }
});

test('stress notifDuration: empty/decimal/huge/zero/negative/max', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#notifDuration');
  for (const [input, expectedShown] of [['', '5'], ['3.9', '3'], ['1000000', '120'], ['0', '0'], ['-99', '5'], ['120', '120']]) {
    await page.fill('#notifDuration', input);
    await page.locator('#notifDuration').blur();
    await expect(page.locator('#notifDuration')).toHaveValue(expectedShown);
    const shown = await page.locator('#notifDuration').inputValue();
    expect(await storedN(page).then(n => String(n.durationSec))).toBe(shown);
  }
});
