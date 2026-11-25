// Verifica #2651, giro 1: pagina lunga con la barra di scorrimento, una riga sottile vicino al bordo destro.
import { test, expect } from '../../fixtures/electron.mjs';
import { premiNellaBarra } from '../../helpers/barra.mjs';
import { PNG } from 'pngjs';

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const scrivi = (app, t) => app.evaluate(({ clipboard }, testo) => clipboard.writeText(testo), t);

const PAGINA = `<!doctype html><html><body style="margin:0;background:#ffffff">
  <div style="position:fixed;left:1150px;top:0;width:3px;height:100vh;background:#ff0000"></div>
  <div style="height:3000px"></div></body></html>`;

function colonnaRossa(buf, y) {
  const png = PNG.sync.read(buf);
  const out = [];
  for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    if (png.data[i] > 200 && png.data[i + 1] < 60 && png.data[i + 2] < 60) out.push(x);
  }
  return { out, w: png.width };
}

test('la riga rossa si prende cliccando dove si vede', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const prima = colonnaRossa(await page.screenshot({ scale: 'css' }), 300);
  console.log('prima', prima, await page.evaluate(() => [innerWidth, document.documentElement.clientWidth]));
  await scrivi(app, 'prima');
  await premiNellaBarra(app, 'colorPicker');
  await expect(page.locator('.sn-color-overlay')).toBeVisible({ timeout: 8000 });
  await page.mouse.move(600, 300);
  const dopo = colonnaRossa(await page.screenshot({ scale: 'css', path: 'tests/.shots/v2651-scorrimento.png' }), 300);
  console.log('con lo strato', dopo);
  const x = dopo.out[1] ?? dopo.out[0];
  await page.mouse.click(x, 300);
  await expect.poll(() => appunti(app), { timeout: 8000 }).toBe('#FF0000');
});
