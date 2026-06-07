import { test } from './fixtures/electron.mjs';

test('debug rows', async ({ openTab }) => {
  const page = await openTab('filo://options/options.html');
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.waitForSelector('#useDefaultModels', { timeout: 8000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    host: !!document.getElementById('modelRegistryList'),
    hostHTML: (document.getElementById('modelRegistryList')?.innerHTML || '').slice(0, 300),
    rows: document.querySelectorAll('.sn-model-row').length,
    bodyRows: document.querySelectorAll('.sn-model-row:not(.sn-model-row-head)').length,
    glProv: !!window.SN_PROVIDER_GEMINI,
    constOk: !!window.SN_CONST,
  }));
  console.log('DEBUG_INFO', JSON.stringify(info));
  console.log('DEBUG_ERRORS', JSON.stringify(errors));
});
