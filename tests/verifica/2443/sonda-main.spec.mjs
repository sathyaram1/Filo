// Sonda di esplorazione: i passi del caso rosso come stavano su main, sotto carico. Da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

test('sonda main: voci lette subito dopo il tasto destro', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ tabPreview: { enabled: false } }));
  const page = await openTab('filo://preferences/preferences.html');
  const casella = page.locator('#tabPreviewEnabled');
  await expect(casella).not.toBeChecked({ timeout: 10_000 });
  const pronto = await page.evaluate(() => document.documentElement.dataset.filoContentReady || 'no');
  await page.locator('label', { has: casella }).click({ button: 'right' });
  const voci = await menuDi(page).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim()));
  let poi = 'mai';
  try { await expect(menuDi(page).voce('Rimetti di serie').first()).toBeVisible({ timeout: 8_000 }); poi = 'aperto'; } catch (_) {}
  console.log(JSON.stringify({ pronto, voci: voci.length, poi }));
});
