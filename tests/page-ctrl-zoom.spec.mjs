// Zoom della pagina con Ctrl/Cmd sulle pagine web (#feedback zoom trackpad/Ctrl+).
//
// FEEDBACK (alpha): "rendi possibile zoommare anche pizzicando il trackpad e
// con cntr +". Prima esisteva solo la modalità zoom col click centrale; non
// si poteva zoomare tenendo Ctrl e usando rotella/pinch né con Ctrl + / -.
//
// Cosa asserisce (successo della feature, non assenza di errore):
//   - Ctrl+rotella su una pagina web cambia lo zoom della pagina (e NON scrolla);
//     il pinch del trackpad arriva come lo stesso evento (wheel con ctrlKey).
//   - Ctrl + ingrandisce, Ctrl - rimpicciolisce, Ctrl 0 torna al 100%.
//
// Pre-condizione che senza il fix fallirebbe: senza i nuovi handler, Ctrl+rotella
// scrolla (o non zooma) e Ctrl +/- non fa nulla → getZoomFactor resta ~1.

import { test, expect } from './fixtures/electron.mjs';

const TALL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>tall</title>
<style>html,body{margin:0} #spacer{height:5000px;background:linear-gradient(#fff,#eee)}</style>
</head><body><div id="spacer">contenuto alto</div></body></html>`;

async function zoomFactorOf(app, hostNeedle) {
  return app.evaluate(({ webContents }, needle) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes(needle)) return wc.getZoomFactor();
    }
    return null;
  }, hostNeedle);
}

test('Ctrl+rotella zooma la pagina e non scrolla', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  const z0 = await zoomFactorOf(app, '127.0.0.1');
  expect(z0).toBeCloseTo(1, 1);

  const scrollBefore = await page.evaluate(() => window.scrollY);

  // Tenendo Ctrl, la rotella zooma (pinch del trackpad → stesso wheel+ctrlKey).
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300); // su = zoom in
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');

  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeGreaterThan(z0 + 0.01);
  // Non ha scrollato la pagina.
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  // Ctrl+rotella giù rimpicciolisce.
  const zUp = await zoomFactorOf(app, '127.0.0.1');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, 300);
  await page.keyboard.up('Control');
  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeLessThan(zUp - 0.01);
});

test('Ctrl + / Ctrl - / Ctrl 0 zoomano e ripristinano la pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  await page.bringToFront();
  await page.locator('body').click(); // focus sulla pagina
  const z0 = await zoomFactorOf(app, '127.0.0.1');
  expect(z0).toBeCloseTo(1, 1);

  // Ctrl + ingrandisce.
  await page.keyboard.press('Control+=');
  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeGreaterThan(z0 + 0.01);

  // Ctrl 0 torna al 100%.
  await page.keyboard.press('Control+0');
  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeCloseTo(1, 1);

  // Ctrl - rimpicciolisce sotto il 100%.
  await page.keyboard.press('Control+-');
  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeLessThan(z0 - 0.01);
});
