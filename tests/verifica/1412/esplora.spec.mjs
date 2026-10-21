import { test, expect } from '../../fixtures/electron.mjs';

test('esplora durata cache in Preferenze e predefiniti', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  for (const theme of ['light', 'dark']) {
    await app.evaluate(async (_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), theme);
    const pref = await openTab('filo://preferences/preferences.html');
    await pref.waitForLoadState('domcontentloaded');
    const sel = pref.locator('#contestoCache');
    await sel.scrollIntoViewIfNeeded();
    await expect(sel).toBeVisible();
    const box = await sel.locator('xpath=ancestor::section[1]').boundingBox();
    await pref.screenshot({ path: `tests/.shots/1412-pref-${theme}.png`, clip: box ? { x: 0, y: Math.max(0, box.y - 10), width: 1400, height: Math.min(500, box.height + 20) } : undefined });
    const adm = await openTab('filo://admin-defaults/admin-defaults.html');
    await adm.waitForLoadState('domcontentloaded');
    const s2 = adm.locator('#contestoCache');
    if (await s2.count()) {
      await s2.scrollIntoViewIfNeeded().catch(() => {});
      await adm.screenshot({ path: `tests/.shots/1412-adm-${theme}.png` });
      console.log('ADM options', await s2.locator('option').allTextContents());
    }
    console.log('PREF options', await sel.locator('option').allTextContents());
  }
});
