// Verifica #2651, giro 1: lo zoom del testo delle pagine di Filo (Preferenze, «dimensione del testo»).
import { test, expect } from '../../fixtures/electron.mjs';
import { premiNellaBarra } from '../../helpers/barra.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const scrivi = (app, t) => app.evaluate(({ clipboard }, testo) => clipboard.writeText(testo), t);

test('nuova scheda col testo al 150%: la lente segue il puntatore', async ({ app }) => {
  const page = await home(app);
  await page.evaluate(() => { document.documentElement.style.zoom = '1.5'; });
  await page.waitForTimeout(300);
  await scrivi(app, 'prima');
  await premiNellaBarra(app, 'colorPicker');
  await expect(page.locator('.sn-color-overlay')).toBeVisible({ timeout: 8000 });
  await page.mouse.move(500, 250, { steps: 4 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/v2651-zoom150-lente.png' });
  const r = await page.locator('.sn-color-overlay').boundingBox();
  console.log('overlay box', r, await page.evaluate(() => [innerWidth, innerHeight, document.documentElement.currentCSSZoom]));
  await page.mouse.click(500, 250);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toMatch(/^#[0-9A-F]{6}$/);
});
