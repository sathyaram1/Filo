// Verifica #1296, giro 1: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, copione, ripristina, testoDellaChiamata } from '../../helpers/copione.mjs';

async function impostazioni(app, settings) {
  await app.evaluate(async (_, st) => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: st },
    { url: 'filo://preferences/preferences.html' },
  ), settings);
}

test('seguito con doppio Invio: il lavoro arriva in fondo e il seguito ha risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Ci penso a lungo. ', 'Ancora. ', 'Ancora un po\'. ', 'Quasi. '], ogni: 700, testo: 'Ecco il primo lavoro.' },
    { pensa: ['Il seguito. '], ogni: 100, testo: 'Ecco anche il seguito.' },
  ]);
  await page.locator('#input').fill('fammi un lavoro lungo');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity-trama').last()).toContainText('a lungo', { timeout: 6_000 });
  await page.waitForTimeout(800);
  await page.locator('#input').fill('e poi fai anche questo');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco il primo lavoro.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco anche il seguito.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-bubble-fermato')).toHaveCount(0);
  await ripristina(app);
});

for (const tema of ['light', 'dark']) {
  test(`punta del filo tagliato prima del primo pensiero, movimento normale, tema ${tema}`, async ({ app, shell }) => {
    test.setTimeout(60_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await configureModel(app);
    await impostazioni(app, { theme: tema });
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', tema, { timeout: 5_000 });
    await copione(app, [{ prima: 30_000, testo: 'Mai.' }]);
    await page.locator('#input').fill('una domanda');
    await page.locator('#sendBtn').click();
    await page.waitForTimeout(900);
    await page.locator('#stopBtn').click();
    await expect(page.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 5_000 });
    await page.waitForTimeout(2500);
    const misure = await page.evaluate(() => {
      const blocco = document.querySelector('.dash-activity[data-fermato="1"]');
      const tratto = blocco.querySelector('.dash-activity-filo-tratto');
      const svg = tratto.ownerSVGElement.getBoundingClientRect();
      const bb = tratto.getBBox();
      const nota = document.querySelector('.dash-bubble-fermato').getBoundingClientRect();
      return { punta: svg.top + bb.y + bb.height, fondoBlocco: blocco.getBoundingClientRect().bottom, nota: nota.top, notaLeft: nota.left, svgLeft: svg.left + bb.x, svgRight: svg.left + bb.x + bb.width };
    });
    console.log(tema, JSON.stringify(misure));
    const box = await page.locator('.dash-activity[data-fermato="1"]').boundingBox();
    await page.screenshot({ path: `tests/.shots/v1296-punta-${tema}.png`, clip: { x: 0, y: Math.max(0, box.y - 60), width: page.viewportSize().width, height: box.height + 160 } });
    await page.screenshot({ path: `tests/.shots/v1296-punta-${tema}-full.png` });
    expect(misure.punta).toBeLessThan(misure.nota);
    await ripristina(app);
  });
}
