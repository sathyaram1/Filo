import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm, confirmState } from './helpers/confirm.mjs';

const ALTRO_URL = 'filo://options/altro.html';

async function seed(page, cats) {
  await page.evaluate(async (c) => { await chrome.storage.local.set({ categories: c }); }, cats);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

test('cancel lascia la categoria intatta', async ({ openTab }) => {
  const page = await openTab(ALTRO_URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page, [{ id: 'c1', name: 'Alfa' }]);
  let nativeDialog = false;
  page.on('dialog', async (d) => { nativeDialog = true; await d.dismiss().catch(() => {}); });
  await page.locator('.sn-cat-row button.sn-btn-secondary').last().click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  await clickConfirm(page, 'cancel');
  await expect(page.locator('.sn-cat-row')).toHaveCount(1);
  const n = await page.evaluate(async () => (await chrome.storage.local.get('categories')).categories.length);
  expect(n).toBe(1);
  expect(nativeDialog).toBe(false);
});

test('nome con HTML/emoji reso safe come testo, popup appare', async ({ openTab }) => {
  const page = await openTab(ALTRO_URL);
  await page.waitForLoadState('domcontentloaded');
  const evil = '<script>window.__x=1</script>😀';
  await seed(page, [{ id: 'c2', name: evil }]);
  let nativeDialog = false;
  page.on('dialog', async (d) => { nativeDialog = true; await d.dismiss().catch(() => {}); });
  await page.locator('.sn-cat-row button.sn-btn-secondary').last().click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  const st = await confirmState(page);
  expect(st.text).toContain('<script>'); // reso come testo letterale
  const executed = await page.evaluate(() => window.__x);
  expect(executed, 'lo script del nome non deve eseguire').toBeUndefined();
  expect(nativeDialog).toBe(false);
});
