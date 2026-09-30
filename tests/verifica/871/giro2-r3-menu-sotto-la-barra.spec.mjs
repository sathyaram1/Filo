// #871 verifica giro 2, rilievo 3: il menu del tasto destro aperto vicino al bordo sinistro resta tutto
// visibile mentre ci si riordinano le icone: la barra che si apre col trascinamento non gli va sopra.

import { test, expect } from '../../fixtures/electron.mjs';
import { statoBarra } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const SITO = `<!doctype html><html><body style="margin:0;padding:12px 16px;font:16px sans-serif;height:1400px">
  <p id="p">Un paragrafo che comincia vicino al bordo sinistro, come in tanti siti.</p></body></html>`;

test('menu aperto vicino al bordo sinistro: trascinando un\'icona dentro il menu, la barra non lo copre', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await page.mouse.click(20, 24, { button: 'right' });
  const icona = page.locator('.sn-menu [data-sn-icon-id="share"]').first();
  await expect(icona).toBeVisible();
  const riga = page.locator('.sn-menu .sn-menu-row[data-sn-drop-target="primary"]').first();
  const box = await icona.boundingBox();
  // Un riordino dentro la riga del menu: il puntatore resta sopra il menu, lontano dal bordo.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 2, { steps: 4 });
  await pausa(500);
  const r = await riga.boundingBox();
  const s = await statoBarra(app);
  const zoom = await page.evaluate(() => window.devicePixelRatio / (window.outerWidth ? 1 : 1));
  const coperto = s.aperta ? Math.max(0, (s.bounds.width - 16) - r.x) : 0;
  await page.mouse.up();
  expect(coperto, `la barra aperta copre i primi ${coperto}px della riga del menu (zoom ${zoom})`).toBe(0);
});
