// Verifica #1343 giro 7, rilievo 2: a schermo intero le schede arrivano solo dal bordo in alto dello schermo; il
// bordo in alto di un riquadro di un altro sito in mezzo alla pagina (un video, una pubblicità) non le chiama.

import { test, expect } from '../../fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const cima = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  return tm.tabs.find((t) => t.id === tm.activeId).view.getBounds().y;
});

test('r2 il puntatore fermo sul bordo alto di un riquadro a metà pagina non scopre le schede', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;background:#cde;height:100vh">Video incorporato</body></html>', { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Articolo</title></head><body style="margin:0;font:16px sans-serif">
    <div style="height:300px;padding:20px">Testo dell'articolo</div>
    <iframe src="${dentro}" style="display:block;width:600px;height:300px;border:0;margin-left:100px"></iframe>
    <div style="height:900px"></div></body></html>`);
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
  await expect.poll(() => cima(app)).toBe(0);

  const riquadro = await page.locator('iframe').boundingBox();
  await page.mouse.move(400, riquadro.y + 100);
  await page.mouse.move(400, riquadro.y + 1, { steps: 4 });
  await pausa(1200);
  expect(await cima(app), 'a metà schermo la pagina resta dov\'è').toBe(0);
});
