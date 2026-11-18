// Esplorazione del giro 1 (da cancellare): foto della home e stato dei tasti.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { home } from '../../helpers/chatFinta.mjs';
import { homeIntera } from '../../helpers/tastiHome.mjs';

const SHOTS = 'tests/.shots/v2372';
mkdirSync(SHOTS, { recursive: true });

async function casa(app) {
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  return page;
}

test('esplora', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await casa(app);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/home-chiara.png` });
  const stato = await page.evaluate(() => ({
    vista: [...document.querySelectorAll('.dash-altro-griglia.vista .dash-altro-app')].map((n) => n.dataset.id || n.id),
    fuori: [...document.querySelectorAll('#altroFuori .dash-altro-app')].map((n) => n.dataset.id),
    campi: [...document.querySelectorAll('input, textarea, [contenteditable="true"]')].filter((n) => { const r = n.getBoundingClientRect(); return r.width && r.height; }).map((n) => n.id || n.className),
    att: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
    carte: [...document.querySelectorAll('#tieni > *')].map((n) => n.dataset.chiave || n.className),
  }));
  console.log('STATO', JSON.stringify(stato));
  const shellBtns = await shell.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width).map((b) => b.id || b.getAttribute('aria-label')));
  console.log('SHELL', JSON.stringify(shellBtns));
  await page.locator('#altroPiu').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/home-piu.png` });
  console.log('FUORI', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#altroFuori .dash-altro-app')].map((n) => n.dataset.id))));
  await page.locator('#altroPiu').click();
  await page.locator('#altro .dash-altro-app[data-id="impostazioni"]').click({ button: 'right' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/home-menu-tasto.png` });
  await page.keyboard.press('Escape');
  await page.locator('#altro .dash-altro-app[data-id="cerca"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/home-ricerca.png` });
  console.log('FUOCO', await page.evaluate(() => document.activeElement && document.activeElement.id));
  await app.evaluate(async () => { const s = await globalThis.SN_STORAGE.getSettings(); await globalThis.SN_STORAGE.saveSettings?.({ ...s, theme: 'dark' }); });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/home-scura.png` });
});
