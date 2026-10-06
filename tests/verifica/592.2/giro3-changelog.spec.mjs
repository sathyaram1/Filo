// Riallineamento #592.2 bis: nel recap 0.2.235 restano tutte e due le novità, quella del benvenuto e quella arrivata da main (cookie dei contenuti incorporati).
import { test, expect } from '../../fixtures/electron.mjs';

test('recap 0.2.235: la novita del benvenuto e quella dei cookie dei contenuti incorporati', async ({ app, openTab }) => {
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
  const novita = page.locator('.dash-recap-features');
  await expect(novita).toBeVisible();
  await expect(novita).toContainText('Userò questo stile');
  await expect(novita).toContainText('Attivo i cookie di Instagram per questo contenuto?');
});
