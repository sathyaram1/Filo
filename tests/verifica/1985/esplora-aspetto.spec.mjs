import { test, expect } from '../../fixtures/electron.mjs';

for (const tema of ['light', 'dark']) {
  test(`preferenze ${tema}`, async ({ app, openTab }) => {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    const pref = await openTab('filo://preferences/preferences.html');
    const casella = pref.locator('#precaricoVisibili');
    await expect(casella).toBeChecked({ timeout: 15_000 });
    await casella.scrollIntoViewIfNeeded();
    await pref.waitForTimeout(500);
    await pref.screenshot({ path: `tests/.shots/1985/pref-${tema}.png` });
    await casella.hover();
    await pref.waitForTimeout(400);
    await pref.screenshot({ path: `tests/.shots/1985/pref-${tema}-hover.png` });
  });
}
