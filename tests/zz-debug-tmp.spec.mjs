import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

test('debug salvataggio opzioni', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab(OPTIONS_URL);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 8_000 });
  const idx = await page.evaluate(() =>
    window.SN_MODEL_USAGE.userActions().indexOf(window.SN_CONST.ACTIONS.ARCHIVE_EMBED));
  const input = page.locator('#modelsGrid .sn-chain').nth(idx).locator('.sn-chain-input').first();
  console.log('valore iniziale', await input.inputValue());
  await input.fill('mio-indicizzatore');
  await input.blur();
  await page.waitForTimeout(1500);
  console.log('valore dopo blur', await input.inputValue());
  console.log('msg', await page.locator('#modelsGrid .sn-chain').nth(idx).locator('.sn-chain-msg').allTextContents());
  const saved = await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    return { embed: s.models[window.SN_CONST.ACTIONS.ARCHIVE_EMBED], useDefault: s.useDefaultModels, nicks: Object.keys(s.modelRegistry || {}).slice(0, 5) };
  });
  console.log('salvato', JSON.stringify(saved));
  console.log('errori pagina', JSON.stringify(errors, null, 1));
  expect(true).toBe(true);
});
