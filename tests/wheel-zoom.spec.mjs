// Modalità zoom con la rotella, attivata dal click centrale.
//
// FEEDBACK (alpha): il click centrale faceva partire l'autoscroll nativo di
// Chromium (scomodo). Ora un click sulla rotella attiva una "modalità zoom" in
// cui la rotella zooma/dezooma la pagina invece di scrollarla; un altro click
// (o Esc) la disattiva.
//
// Cosa asserisce (successo della feature, non assenza di errore):
//   - dopo il click centrale la pagina entra in modalità zoom (marker DOM +
//     badge visibile);
//   - in modalità zoom la rotella cambia lo zoom della pagina e NON scrolla;
//   - un secondo click centrale esce dalla modalità e la rotella torna a
//     scrollare.
//
// Pre-condizione che senza il fix fallirebbe: prima non esisteva alcuna
// modalità zoom — il click centrale non impostava filoZoomMode e la rotella
// scrollava sempre.

import { test, expect } from './fixtures/electron.mjs';

const TALL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>tall</title>
<style>html,body{margin:0} #spacer{height:5000px;background:linear-gradient(#fff,#eee)}</style>
</head><body><div id="spacer">contenuto alto per scrollare</div></body></html>`;

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

test('rotella: il click centrale attiva la modalità zoom, la rotella zooma e non scrolla', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);

  // Fuori dalla modalità zoom: nessun marker.
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('');

  const z0 = await zoomFactorOf(app, '127.0.0.1');
  expect(z0).toBeCloseTo(1, 1);

  // Click centrale su area vuota → entra in modalità zoom.
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('1');
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();

  // In modalità zoom la rotella zooma (non scrolla).
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -300); // su = zoom in
  await page.mouse.wheel(0, -300);

  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeGreaterThan(z0 + 0.01);
  const scrollAfterZoom = await page.evaluate(() => window.scrollY);
  expect(scrollAfterZoom).toBe(scrollBefore); // non ha scrollato

  // Secondo click centrale → esce dalla modalità zoom.
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('');
  await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);

  // Fuori dalla modalità, la rotella torna a scrollare.
  const zAfterExit = await zoomFactorOf(app, '127.0.0.1');
  await page.mouse.wheel(0, 300); // giù = scroll
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  // ...e NON ha più cambiato lo zoom.
  expect(await zoomFactorOf(app, '127.0.0.1')).toBeCloseTo(zAfterExit, 2);
});

test('rotella: Esc esce dalla modalità zoom', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('1');
  await page.keyboard.press('Escape');
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('');
});
