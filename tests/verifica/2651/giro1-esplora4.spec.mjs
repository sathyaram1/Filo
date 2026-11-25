// Verifica #2651, giro 1: barra bloccata (spinge la pagina), fila del tasto destro sulla nuova scheda, sito con zoom.
import { test, expect } from '../../fixtures/electron.mjs';
import { premiNellaBarra, mettiNellaBarra, statoBarra } from '../../helpers/barra.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><html><head><title>Colori</title></head><body style="margin:0">
  <div style="position:fixed;left:0;top:0;width:200px;height:100vh;background:#12ab34"></div>
  <div style="position:fixed;left:200px;top:0;right:0;height:100vh;background:#e05a2b"></div></body></html>`;

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const scrivi = (app, t) => app.evaluate(({ clipboard }, testo) => clipboard.writeText(testo), t);

test('barra bloccata: il contagocce resta aperto e prende il colore', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.barra.blocca(true, null);
  });
  await page.waitForTimeout(800);
  console.log('stato', JSON.stringify(await statoBarra(app)), await page.evaluate(() => innerWidth));
  await scrivi(app, 'prima');
  await premiNellaBarra(app, 'colorPicker');
  await page.waitForTimeout(1500);
  console.log('dopo', JSON.stringify(await statoBarra(app)), await page.evaluate(() => innerWidth));
  await expect(page.locator('.sn-color-overlay')).toBeVisible({ timeout: 8000 });
  await page.mouse.click(400, 300);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#E05A2B');
});

test('nuova scheda: dalla fila del tasto destro', async ({ app }) => {
  const page = await home(app);
  await mettiNellaBarra(app, ['colorPicker'], 'fila:pagina');
  await scrivi(app, 'prima');
  await page.mouse.click(500, 300, { button: 'right' });
  const menu = menuDi(page);
  const voce = menu.locator('.sn-menu-row [data-sn-icon-id="colorPicker"]');
  console.log('voce nella fila', await voce.count());
  await voce.click({ timeout: 5000 });
  await expect(page.locator('.sn-color-overlay')).toBeVisible({ timeout: 8000 });
  await page.mouse.click(510, 310);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toMatch(/^#[0-9A-F]{6}$/);
});

test('sito con html zoom 1.5: la lente si vede vicino al puntatore', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA.replace('<head>', '<head><style>html{zoom:1.5}</style>'));
  await premiNellaBarra(app, 'colorPicker');
  await expect(page.locator('.sn-color-overlay')).toBeVisible({ timeout: 8000 });
  await page.mouse.move(700, 500, { steps: 3 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/v2651-sito-zoom.png' });
  await page.keyboard.press('Escape');
});
