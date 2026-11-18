// Esplorazione del giro 1 (da cancellare).
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
const stato = (page) => page.evaluate(() => ({
  tieni: [...document.querySelectorAll('#tieni > *')].map((n) => n.dataset.tipo || n.className),
  fuori: [...document.querySelectorAll('#altroFuori .dash-altro-app')].map((n) => n.dataset.id),
}));
const layout = (app) => app.evaluate(async () => (await chrome.storage.local.get('filo_carte_home')));

test('editor nel piu', async ({ app }) => {
  const page = await casa(app);
  console.log('S0', JSON.stringify(await stato(page)));
  await page.locator('#tieni .dash-carta[data-tipo="editor"]').dragTo(page.locator('#altroPiu'));
  await page.waitForTimeout(500);
  console.log('S1', JSON.stringify(await stato(page)));
  await page.reload();
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  console.log('S2', JSON.stringify(await stato(page)));
  await page.locator('#altroPiu').click();
  await page.locator('#altroFuori .dash-altro-app[data-id="editor"]').click();
  await page.waitForTimeout(800);
  console.log('S3', JSON.stringify(await stato(page)));
  await page.screenshot({ path: 'tests/.shots/v2372/editor-tornato.png' });
});
