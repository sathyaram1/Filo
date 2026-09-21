// TEMPORANEO: diagnosi persistenza esito Prova. Da cancellare.
import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

test('debug registry persistence', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });

  const before = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')];
    return rows.map((r) => r.querySelector('.sn-model-nick')?.value);
  });
  console.log('RIGHE PRIMA:', JSON.stringify(before));

  await page.evaluate(() => {
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    row.querySelector('.sn-model-nick').value = 'provatm';
    row.querySelector('.sn-model-provider').value = 'openrouter';
    row.querySelector('.sn-model-id').value = 'anthropic/claude-3.5-haiku';
    row._test = { ttftMs: 321, tokensPerSec: 48.5, at: new Date().toISOString() };
    row.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  const subito = await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    return { nickDom: row.querySelector('.sn-model-nick').value, ha: !!(s.modelRegistry || {}).provatm };
  });
  console.log('SUBITO DOPO hint:', JSON.stringify(subito));

  await page.waitForTimeout(2000);
  const dopo2s = await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    return { nickDom: row.querySelector('.sn-model-nick').value, provatm: (s.modelRegistry || {}).provatm };
  });
  console.log('DOPO 2s:', JSON.stringify(dopo2s));

  await page.reload();
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.waitForTimeout(1500);

  const after = await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    const rows = [...document.querySelectorAll('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')];
    return {
      useDefaultModels: s.useDefaultModels,
      regKeys: Object.keys(s.modelRegistry || {}),
      provatm: (s.modelRegistry || {}).provatm,
      hidden: document.getElementById('sec-model-registry')?.hidden,
      rows: rows.map((r) => [r.querySelector('.sn-model-nick')?.value, r.querySelector('.sn-model-row-status')?.textContent]),
    };
  });
  console.log('DOPO RELOAD:', JSON.stringify(after).slice(0, 3000));
});
