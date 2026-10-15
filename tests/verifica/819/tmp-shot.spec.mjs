import { test, expect } from '../../fixtures/electron.mjs';
test('shot', async ({ app, openTab }) => {
  await app.evaluate(async () => { const T = globalThis.SN_TEST_MODELS; await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, modelRegistry: T.registry, models: T.models }); });
  const page = await openTab('filo://options/options.html');
  await page.waitForTimeout(2500);
  const cell = page.locator('#modelsGrid > div').filter({ has: page.locator('label', { hasText: 'Dettatura' }) });
  await cell.scrollIntoViewIfNeeded();
  await cell.screenshot({ path: 'tests/.shots/v819-dettatura.png' });
  await page.screenshot({ path: 'tests/.shots/v819-griglia.png' });
  console.log(await page.evaluate(() => window.innerWidth));
});
