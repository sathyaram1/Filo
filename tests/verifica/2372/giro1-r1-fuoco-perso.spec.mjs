// Verifica #2372, giro 1, rilievo 1: la home ha un campo solo «sempre col fuoco», ma dopo un clic su un punto vuoto
// solo le lettere ci arrivano: Backspace e Ctrl+V vanno persi.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { homeIntera } from '../../helpers/tastiHome.mjs';

async function casa(app) {
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  return page;
}

test('r1 dopo un clic su un punto vuoto, Backspace e Ctrl+V finiscono nel campo della chat come le lettere', async ({ app }) => {
  const page = await casa(app);
  await page.keyboard.type('ciao');
  await expect(page.locator('#input')).toHaveValue('ciao');
  await page.mouse.click(640, 300);
  await page.keyboard.press('Backspace');
  await expect.soft(page.locator('#input')).toHaveValue('cia');
  await page.locator('#input').fill('cia');
  await app.evaluate(({ clipboard }) => clipboard.writeText(' incollato'));
  await page.mouse.click(640, 300);
  await page.keyboard.press('Control+V');
  await expect(page.locator('#input')).toHaveValue('cia incollato');
});
