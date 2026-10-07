// Riallineamento #592.2: il recap di chi passa dalla 0.2.234 alla 0.2.235 mostra la riga del benvenuto e quella dei siti dal nome comune.
import { test, expect } from '../../fixtures/electron.mjs';

test('recap 0.2.235: novita del benvenuto e correzione dei siti dal nome comune', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(async ({ app }) => {
    app.getVersion = () => '0.2.235';
    const KEYS = globalThis.SN_CONST.STORAGE_KEYS;
    await globalThis.chrome.storage.local.remove(KEYS.LAST_SEEN_NOTES);
    await globalThis.SN_STORAGE.setRaw(KEYS.LAST_SEEN_VERSION, '0.2.234');
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#recapOverlay')).toBeVisible();
  await expect(page.locator('.dash-recap-features')).toContainText('Userò questo stile');
  await expect(page.locator('#recapOverlay')).toContainText('Un sito dal nome comune non passa più');
});
