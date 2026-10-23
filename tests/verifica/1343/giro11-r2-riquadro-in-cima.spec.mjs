// Verifica #1343 giro 11, rilievo 2: a schermo intero le schede arrivano dal bordo in alto anche quando la cima della
// pagina è un riquadro di un altro sito (una pubblicità in testa, un lettore, un'app incorporata).

import { test, expect } from '../../fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test('r2 a schermo intero col puntatore fermo sul bordo alto, sopra un riquadro di un altro sito, le schede compaiono', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;background:#cde;height:100vh">Pubblicità</body></html>', { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Testa</title></head><body style="margin:0">
    <iframe src="${dentro}" style="display:block;width:100%;height:250px;border:0"></iframe><div style="height:1200px">Articolo</div></body></html>`);
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
  await pausa(800);
  await page.mouse.move(400, 150);
  await page.mouse.move(400, 0, { steps: 5 });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    return tm.schedeInAlto.visibili;
  }), { timeout: 4000, message: 'le schede arrivano anche sopra il riquadro' }).toBe(true);
});
