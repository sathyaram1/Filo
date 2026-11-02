// Verifica #1434 giro 3: esplorazione (si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <input id="pw" type="password" value="segretissima" style="display:block;width:300px">
  <p id="testo">Un paragrafo di prova da selezionare.</p>
  <img id="foto" src="${img}" width="120" height="80">
  <p><a id="ln" href="https://esempio.it/x">un collegamento</a></p>
  </body></html>`;

const ids = (menu) => menu.locator('.sn-menu-row [data-sn-icon-id]').evaluateAll((els) => els.map((e) => e.dataset.snIconId));

test('esplora: taglia su password', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO(testServer.asset(PNG, 'image/png')));
  const menu = menuDi(page);
  await app.evaluate(({ clipboard }) => clipboard.writeText('VUOTO'));
  await page.locator('#pw').click();
  await page.locator('#pw').evaluate((e) => e.setSelectionRange(0, 12));
  const b = await page.locator('#pw').boundingBox();
  await page.mouse.click(b.x + 20, b.y + b.height / 2, { button: 'right' });
  await expect(menu.principale).toBeVisible();
  console.log('pw fila', JSON.stringify(await ids(menu)));
  await menu.locator('.sn-menu-row [data-sn-icon-id="campo:cut"]').click();
  await page.waitForTimeout(600);
  console.log('pw dopo taglia', JSON.stringify(await page.locator('#pw').inputValue()), '| appunti', await app.evaluate(({ clipboard }) => clipboard.readText()));
});

test('esplora: tasti destri in fretta', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO(testServer.asset(PNG, 'image/png')));
  const menu = menuDi(page);
  const img = await page.locator('#foto').boundingBox();
  const ln = await page.locator('#ln').boundingBox();
  const vuoto = { x: 600, y: 400 };
  const punti = [img, ln, vuoto, img, ln, img].map((p) => (p.width ? { x: p.x + p.width / 2, y: p.y + p.height / 2 } : p));
  for (const p of punti) await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(800);
  console.log('dopo raffica', await menu.principale.count(), JSON.stringify(await ids(menu)));
});
