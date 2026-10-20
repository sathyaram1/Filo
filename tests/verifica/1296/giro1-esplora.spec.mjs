// Verifica #1296, giro 1: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, copione, ripristina } from '../../helpers/copione.mjs';

async function impostazioni(app, settings) {
  await app.evaluate(async (_, st) => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: st },
    { url: 'filo://preferences/preferences.html' },
  ), settings);
}

for (const tema of ['light', 'dark']) {
  test(`seguito in attesa, aspetto, tema ${tema}`, async ({ app, shell }) => {
    test.setTimeout(60_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await configureModel(app);
    await impostazioni(app, { theme: tema });
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', tema, { timeout: 5_000 });
    await copione(app, [
      { pensa: ['Ci penso a lungo. ', 'Ancora. ', 'Ancora un po\'. ', 'Quasi. ', 'Eccomi. '], ogni: 900, testo: 'Ecco il primo lavoro.' },
      { pensa: ['Il seguito. '], ogni: 100, testo: 'Ecco anche il seguito.' },
    ]);
    await page.locator('#input').fill('fammi un lavoro lungo');
    await page.locator('#input').press('Enter');
    await expect(page.locator('.dash-activity-trama').last()).toContainText('a lungo', { timeout: 6_000 });
    await page.locator('#input').fill('e poi fai anche questo');
    await page.keyboard.press('Enter');
    await expect(page.locator('.dash-bubble-attesa')).toBeVisible({ timeout: 2_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tests/.shots/v1296-attesa-${tema}.png` });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco anche il seguito.' })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `tests/.shots/v1296-attesa-fine-${tema}.png` });
    await ripristina(app);
  });
}
