import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');

test('esplora: chip autonomia in vari stati', async ({ app, openTab }) => {
  mkdirSync(SHOTS, { recursive: true });
  const page = await home(app);
  await page.screenshot({ path: join(SHOTS, 'g9-home-chiaro.png') });
  await modelloFinto(app, [{ text: 'Ok, ecco.' }]);
  try {
    await chiedi(page, 'ciao');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SHOTS, 'g9-home-thread.png') });
  } finally { await ripristina(app); }
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true, shell: 'bash' } }));
  const page2 = await home(app);
  await page2.reload();
  await page2.waitForTimeout(1500);
  await page2.screenshot({ path: join(SHOTS, 'g9-home-terminale.png') });
  console.log('chip visibile in terminale:', await page2.locator('#dashAutonomia').isVisible());
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }));
  await page2.waitForTimeout(600);
  await page2.screenshot({ path: join(SHOTS, 'g9-home-terminale-scuro.png') });
  const prefs = await openTab('filo://preferences/preferences.html#autonomia');
  await prefs.waitForTimeout(1200);
  await prefs.screenshot({ path: join(SHOTS, 'g9-prefs-scuro.png') });
  await prefs.locator('label:has(#autonomia-automatico)').click();
  await prefs.waitForTimeout(800);
  await prefs.screenshot({ path: join(SHOTS, 'g9-prefs-conferma-scuro.png') });
  const w = await app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; b.setSize(520, 700); return b.getSize(); });
  console.log('size', w);
  await page2.bringToFront?.();
  await page2.waitForTimeout(800);
  await page2.screenshot({ path: join(SHOTS, 'g9-home-stretta.png') });
  expect(true).toBe(true);
});
