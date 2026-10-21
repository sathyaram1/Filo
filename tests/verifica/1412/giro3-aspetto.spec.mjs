// Verifica #1412 giro 3: fotografie della tendina della cache in Preferenze e nei modelli predefiniti, chiaro e scuro.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

test('foto della durata della cache', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  mkdirSync('tests/.shots', { recursive: true });
  for (const theme of ['light', 'dark']) {
    await app.evaluate(async (_e, theme) => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme } }, { url: 'filo://preferences/preferences.html' }), theme);
    const pref = await openTab('filo://preferences/preferences.html');
    await expect(pref.locator('#contestoCachePredefinita')).toHaveText(/un'ora/);
    await pref.locator('#sec-contesto').scrollIntoViewIfNeeded();
    await pref.waitForTimeout(500);
    await pref.locator('#sec-contesto').screenshot({ path: `tests/.shots/1412-pref-${theme}.png` });
    const adm = await openTab('filo://admin-defaults/admin-defaults.html');
    await adm.waitForTimeout(1500);
    const sel = adm.locator('#contestoCache');
    if (await sel.count()) {
      await sel.scrollIntoViewIfNeeded().catch(() => {});
      await adm.waitForTimeout(300);
      await sel.locator('xpath=..').screenshot({ path: `tests/.shots/1412-admin-${theme}.png` }).catch(() => {});
    }
  }
});
