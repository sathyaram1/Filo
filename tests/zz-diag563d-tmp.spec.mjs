import { test, expect } from './fixtures/electron.mjs';

test('diag 563: cosa fa setBounds al 125%', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0"><p id="p">ciao</p></body></html>');
  const leggi = async (etichetta) => {
    const b = await app.evaluate(async ({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const d = screen.getPrimaryDisplay();
      return {
        bounds: w.getBounds(), content: w.getContentBounds(),
        minSize: w.getMinimumSize(),
        display: { size: d.size, workArea: d.workArea, scale: d.scaleFactor },
      };
    });
    const vh = await page.evaluate(() => ({ innerHeight: window.innerHeight, dpr: window.devicePixelRatio }));
    console.log(etichetta, JSON.stringify({ ...b, ...vh }));
  };
  await leggi('PRIMA');
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const b = w.getBounds();
    w.setBounds({ ...b, height: Math.max(240, b.height - 340) });
  });
  await page.waitForTimeout(1500);
  await leggi('DOPO');
  expect(true).toBe(true);
});
