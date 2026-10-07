// #686.1 giro 10, rilievo 1: il riquadro con la percentuale cresce e si rimpicciolisce con lo zoom della pagina.
// Sullo schermo deve restare della stessa misura: al 300% copriva il titolo, al 33% non si leggeva.

import { test, expect } from '../../fixtures/electron.mjs';

async function zoomA(app, page, livello) {
  const url = await page.evaluate(() => location.href);
  await app.evaluate(({ webContents }, { u, livello }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) wc.setZoomLevel(livello);
    }
  }, { u: url, livello });
}

// Altezza del riquadro in pixel dello schermo: CSS per devicePixelRatio, che contiene lo zoom.
const altezzaVera = (page) => page.locator('#__filo-zoom-badge').evaluate((el) => el.getBoundingClientRect().height * devicePixelRatio);

test('r1 il riquadro dello zoom ha la stessa misura sullo schermo al 100%, al 300% e al 33%', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:20px;height:3000px">
    <h1>Ricetta della torta</h1><p>Farina, uova, zucchero e burro.</p></body></html>`);
  const misure = {};
  for (const [nome, livello] of [['100%', 0], ['300%', Math.log(3) / Math.log(1.2)], ['33%', Math.log(1 / 3) / Math.log(1.2)]]) {
    await zoomA(app, page, livello);
    await page.waitForTimeout(300);
    await page.mouse.click(300, 400, { button: 'middle' });
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    misure[nome] = await altezzaVera(page);
    await page.mouse.click(300, 400, { button: 'middle' });
    await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
  }
  for (const nome of ['300%', '33%']) {
    const rapporto = misure[nome] / misure['100%'];
    expect.soft(rapporto, `al ${nome} il riquadro è ${rapporto.toFixed(2)} volte quello al 100%`).toBeGreaterThan(0.75);
    expect.soft(rapporto, `al ${nome} il riquadro è ${rapporto.toFixed(2)} volte quello al 100%`).toBeLessThan(1.35);
  }
});
