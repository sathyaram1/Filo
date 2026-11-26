// Verifica #2662 giro 2: fotografia della riga del cambio, per il confronto col main (solo esplorazione).

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const STILE = 'Rispondi in modo breve, diretto e senza giri di parole, dammi del tu';

test('fotografa la riga del cambio con un valore di una frase', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate((_e, v) => globalThis.SN_STORAGE.updateSettings({ agentStyle: v }), STILE);
  const nata = page.locator('.dash-cambio', { hasText: 'stile dell' }).last();
  await expect(nata).toBeVisible({ timeout: 10_000 });
  const riga = page.locator(`.dash-cambio[data-id="${await nata.getAttribute('data-id')}"]`);
  await riga.screenshot({ path: 'tests/.shots/v2662g2-riga-ferma.png' });
  await riga.hover();
  await riga.screenshot({ path: 'tests/.shots/v2662g2-riga-sopra.png' });
  await riga.locator('.dash-cambio-annulla').click();
  await expect(riga.locator('.dash-cambio-stato')).toHaveText('annullato', { timeout: 10_000 });
  await page.mouse.move(5, 5);
  await riga.screenshot({ path: 'tests/.shots/v2662g2-riga-annullata.png' });
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w._filoTabs) w.setSize(1000, 760); });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(1100);
  await riga.screenshot({ path: 'tests/.shots/v2662g2-riga-stretta.png' });
});
