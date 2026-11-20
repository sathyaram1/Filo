// Verifica #1403.1, giro 1: un file di testo salvato da Windows in UTF-16 (quello che scrive PowerShell 5.1 con «>»)
// si rilegge come se fosse UTF-8, e la password dentro non si riconosce.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtab(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

test('r2 un log in UTF-16 con «password = hunter22»: il riquadro si riapre con l\'avviso', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await app.evaluate(async () => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { ...T.models }, modelRegistry: T.registry,
    });
    globalThis.__invii = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__invii.push(p); return { id: 'fb-1', seq: 1, failed: [] }; };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({ text: '{"trovati":[]}', provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: {} });
  });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Allego il log: il login fallisce sempre.');
  // La stessa riga che in UTF-8 viene riconosciuta, salvata con la codifica di PowerShell 5.1.
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('avvio...\r\npassword = hunter22\r\nerrore 401\r\n', 'utf16le')]);
  await page.locator('.sn-fb-file').setInputFiles([{ name: 'output.txt', mimeType: 'text/plain', buffer: utf16 }]);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-l0'), 'il riquadro si riapre con l\'avviso').toBeVisible({ timeout: 12_000 });
  expect(await app.evaluate(() => globalThis.__invii.length)).toBe(0);
});
