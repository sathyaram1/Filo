import { test, expect } from './fixtures/electron.mjs';

test('debug tendina TTS', async ({ openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 6_000 });
  await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 6_000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')]
    .map((r) => ({ nick: r.querySelector('.sn-model-nick').value, entry: r._entry })).slice(0, 4));
  console.log('ROWS', JSON.stringify(rows));
  const cell = page.locator('#modelsGrid > div').filter({ hasText: 'Lettura ad alta voce' });
  console.log('CELLS', await cell.count());
  const seg = cell.locator('.sn-chain-seg').first();
  await seg.locator('.sn-chain-input').focus();
  const pop = seg.locator('.sn-chain-pop');
  await expect(pop).toBeVisible({ timeout: 4_000 });
  const opts = await pop.locator('.sn-select-option').evaluateAll((els) => els.map((e) => e.dataset.value + ':' + e.className));
  console.log('OPTS', JSON.stringify(opts));
  expect(true).toBe(true);
});
