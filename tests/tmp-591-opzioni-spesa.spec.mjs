// Esplorazione usa e getta: guardo la riga nuova nella sezione Costi delle
// Opzioni, nei due temi. Da cancellare.

import { test } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

for (const tema of ['light', 'dark']) {
  test(`opzioni costi ${tema}`, async ({ app, openTab }) => {
    await app.evaluate(async ({}, t) => {
      const K = globalThis.SN_CONST.STORAGE_KEYS;
      await chrome.storage.local.set({
        [K.COSTS]: { months: { [globalThis.SN_COSTS.monthKey()]: { totalEur: 1.2345, proprieEur: 6.7891, byAction: {}, byProvider: {} } } },
      });
      const s = await globalThis.SN_STORAGE.getSettings();
      await globalThis.SN_STORAGE.setSettings({ ...s, theme: t });
    }, tema);
    const page = await openTab(OPTIONS_URL);
    await page.waitForSelector('#spentBox');
    await page.waitForTimeout(800);
    await page.locator('#spentBox').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tests/.shots/591-opzioni-costi-${tema}.png`, fullPage: false });
  });
}
