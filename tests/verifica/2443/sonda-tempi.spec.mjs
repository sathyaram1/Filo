// Sonda di esplorazione: tempi del menu sulle Preferenze, da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

for (let i = 0; i < 4; i++) {
  test(`sonda ${i}: tasto destro subito dopo l'apertura`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ tabPreview: { enabled: false } }));
    const t0 = Date.now();
    const page = await openTab('filo://preferences/preferences.html');
    const casella = page.locator('#tabPreviewEnabled');
    await expect(casella).not.toBeChecked({ timeout: 10_000 });
    const tCasella = Date.now() - t0;
    const pronto0 = await page.evaluate(() => document.documentElement.dataset.filoContentReady || 'no');
    await page.locator('label', { has: casella }).click({ button: 'right' });
    const tClick = Date.now() - t0;
    let tVisibile = -1; let tVoce = -1;
    try { await expect(menuDi(page).principale).toBeVisible({ timeout: 8_000 }); tVisibile = Date.now() - t0; } catch (_) {}
    const subito = await menuDi(page).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim()));
    try { await expect(menuDi(page).voce('Rimetti di serie').first()).toBeVisible({ timeout: 8_000 }); tVoce = Date.now() - t0; } catch (_) {}
    const tPronto = await page.evaluate(() => document.documentElement.dataset.filoContentReady || 'no');
    console.log(JSON.stringify({ i, tCasella, pronto0, tClick, tVisibile, tVoce, tPronto, subito }));
  });
}
