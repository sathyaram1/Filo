// #589.11 giro 2, rilievo 1: su una pagina che si fa scura invertendo i colori (o in scala di grigi), aprire il menu
// toglie l'effetto a tutta la pagina finché il menu resta aperto: la pagina lampeggia chiara a ogni tasto destro.
import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'pw-Segreta-589-undici';

// Colore di un punto della scheda, letto da ciò che Electron disegna davvero.
function pixel(app, page, x, y) {
  return app.evaluate(async ({ BrowserWindow }, { u, x, y }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => { try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; } });
      if (!tab) continue;
      const img = await tab.view.webContents.capturePage({ x, y, width: 1, height: 1 });
      const b = img.toBitmap();
      return (b[0] + b[1] + b[2]) / 3;
    }
    return null;
  }, { u: page.url(), x, y });
}

test('r1 la pagina scura per inversione resta scura col menu aperto, e il menu incolla', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await testServer.openReady(openTab, `<!doctype html><html style="filter:invert(1) hue-rotate(180deg)">
    <body style="padding:40px;background:#fff;color:#000"><h1>Pagina in tema scuro</h1>
    <input id="campo" style="width:320px;font-size:16px"></body></html>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  await expect.poll(() => pixel(app, page, 900, 600)).toBeLessThan(60);

  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await pixel(app, page, 900, 600), 'lontano dal menu la pagina resta scura').toBeLessThan(60);

  await page.locator('.sn-menu-paste-main').click();
  await expect(page.locator('#campo')).toHaveValue(SEGRETO);
});
