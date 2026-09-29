// Verifica #588.5 giro 4, rilievo 3 — nel vuoto attorno agli avvisi il puntatore è quello della pagina sotto:
// la freccia sullo sfondo, la mano su un collegamento.
import { test, expect } from '../../fixtures/electron.mjs';

function gestoNellaVista(app, ev) {
  return app.evaluate(({ BrowserWindow }, e) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisi.vista.webContents.sendInputEvent(e);
  }, ev);
}

test('nel vuoto accanto alla carta: freccia sopra lo sfondo, mano sopra un collegamento', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:100vh;background:#fff">
    <a id="lnk" href="#x" style="position:fixed;right:0;bottom:0;display:block;width:600px;height:8px"></a></body></html>`);
  await shell.evaluate(() => window.filoNotify('Avviso qualunque', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisi.vista.getBounds());
  expect(b.width).toBeGreaterThan(100);
  const cursore = () => vista.evaluate(() => getComputedStyle(document.documentElement).cursor);
  // Margine basso della vista: sopra lo sfondo (12 px dal fondo) e sopra il collegamento (4 px dal fondo).
  const x = b.width - 100;
  for (const [y, atteso] of [[b.height - 12, 'default'], [b.height - 4, 'pointer'], [b.height - 12, 'default']]) {
    for (let i = 0; i < 4; i++) await gestoNellaVista(app, { type: 'mouseMove', x: x - 12 + i * 4, y });
    await expect.poll(cursore, { timeout: 3000 }).toBe(atteso);
  }
  expect(await page.evaluate(() => 1)).toBe(1);
});
