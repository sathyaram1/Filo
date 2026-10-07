// #686.1 giro 10, esplorazione: come si vede il riquadro dello zoom (screenshot in tests/.shots/).

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

const testo = '<h1>Ricetta della torta</h1><p>' + 'Farina, uova, zucchero e burro. '.repeat(40) + '</p>';
for (const [nome, sfondo, livello] of [
  ['chiaro-100', '#fff', 0],
  ['scuro-100', '#111', 0],
  ['chiaro-25', '#fff', -7.6],
  ['chiaro-50', '#fff', -3.8],
  ['chiaro-300', '#fff', 6],
]) {
  test(`aspetto ${nome}`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:20px;background:${sfondo};color:${sfondo === '#fff' ? '#222' : '#ddd'};font:16px serif">${testo}</body></html>`);
    await zoomA(app, page, livello);
    await page.waitForTimeout(300);
    await page.mouse.click(300, 300, { button: 'middle' });
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    await page.waitForTimeout(300);
    const fs = await page.locator('#__filo-zoom-badge').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { font: getComputedStyle(el).fontSize, w: r.width, h: r.height, dpr: devicePixelRatio };
    });
    console.log(nome, JSON.stringify(fs));
    await page.screenshot({ path: `tests/.shots/686-giro10-${nome}.png` });
  });
}
