// #1083 giro 1 — con molte schede dalle icone pesanti la barra non deve impuntarsi a ogni aggiornamento delle schede.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(120000);

test('r2 quindici schede con icone da 200 KB: un aggiornamento delle schede non blocca la barra', async ({ app, shell, openTab, testServer }) => {
  const png = await app.evaluate(({ nativeImage }) => {
    const n = 256 * 256 * 4;
    const buf = Buffer.alloc(n);
    for (let i = 0; i < n; i++) buf[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
    return nativeImage.createFromBitmap(buf, { width: 256, height: 256 }).toPNG().toString('base64');
  });
  for (let i = 0; i < 15; i++) {
    const ico = testServer.asset(Buffer.from(png, 'base64'), 'image/png');
    await openTab(testServer.html(`<!doctype html><title>S${i}</title><link rel="icon" href="${ico}">x`));
  }
  await expect.poll(() => shell.evaluate(() => [...document.querySelectorAll('.tab .favicon')]
    .filter((x) => x.style.backgroundImage.startsWith('url("data:')).length), { timeout: 30000 }).toBeGreaterThanOrEqual(15);
  await shell.evaluate(() => {
    window.__lunghi = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lunghi.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] });
  });
  // Un aggiornamento qualunque (titolo, caricamento, audio) ridisegna la barra: sessanta, uno per fotogramma.
  await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    for (let i = 0; i < 60; i++) { tm._broadcast(); await new Promise((r) => setTimeout(r, 16)); }
  });
  await new Promise((r) => setTimeout(r, 1500));
  const lunghi = await shell.evaluate(() => window.__lunghi);
  expect(lunghi.length, `blocchi sopra i 50 ms nella barra: ${lunghi.join(', ')}`).toBeLessThan(10);
});
