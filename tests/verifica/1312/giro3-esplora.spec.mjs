// Esplorazione del giro 3 (si cancella): Preferenze, sezione Autonomia, in tema chiaro e scuro.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');

test('aspetto della sezione Autonomia in chiaro e scuro', async ({ app, openTab }) => {
  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await app.evaluate((_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    const page = await openTab('filo://preferences/preferences.html');
    const sezione = page.locator('#autonomia');
    await sezione.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await sezione.screenshot({ path: join(SHOTS, `g3-autonomia-${tema}.png`) });
    await page.locator('label:has(#autonomia-automatico)').click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(SHOTS, `g3-autonomia-alza-${tema}.png`) });
    await expect(sezione).toBeVisible();
  }
});
