// Verifica #1312 giro 2: esplorazione visiva della sezione Autonomia e del riquadro della parola, chiaro e scuro.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');

test('aspetto', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await app.evaluate((_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    const p = await openTab('filo://preferences/preferences.html');
    const s = p.locator('#autonomia');
    await s.scrollIntoViewIfNeeded();
    await p.waitForTimeout(500);
    await s.screenshot({ path: join(SHOTS, `g2-autonomia-${tema}.png`) });
    await p.close();
  }
  const page = await home(app);
  try {
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ monthlyLimitEur: 5 }));
    await modelloFinto(app, [
      { toolCalls: [{ id: 'a1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'limite_spesa', valore: '50' }) }] },
      { text: 'Serve la tua conferma.' },
    ]);
    await chiedi(page, 'alza il tetto di spesa a 50 euro');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(SHOTS, 'g2-tetto-dark.png') });
  } finally {
    await ripristina(app);
  }
});
