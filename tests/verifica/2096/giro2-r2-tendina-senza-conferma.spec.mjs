// Verifica #2096 giro 2, rilievo 2: «Rimetti di serie» su una tendina (il tema scelto) chiede conferma dicendo che si
// perde «il testo che hai scritto»: una scelta non è un testo scritto, e si rimette come un interruttore.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { confirmState } from '../../helpers/confirm.mjs';

test('r2 Preferenze: «Rimetti di serie» sul tema scuro lo rimette senza chiedere di un testo scritto', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  const page = await openTab('filo://preferences/preferences.html');
  await expect(page.locator('#theme')).toHaveValue('dark', { timeout: 10_000 });
  await page.locator('#theme').locator('xpath=..').locator('.sn-select-button').first().click({ button: 'right' });
  await menuDi(page).voce('Rimetti di serie').first().click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme), { timeout: 5_000 }).toBe('system');
  const s = await confirmState(page);
  expect(s && s.text).not.toContain('testo che hai scritto');
});
