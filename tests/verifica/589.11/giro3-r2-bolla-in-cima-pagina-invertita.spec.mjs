// #589.11 giro 3, rilievo 2: su una pagina scura per inversione, un elemento del sito al piano più alto (la bolla di
// una chat) perde l'inversione finché il menu resta aperto: da scura diventa chiara e torna scura alla chiusura.
import { test, expect } from '../../fixtures/electron.mjs';

function luce(app, page, x, y) {
  return app.evaluate(async ({ BrowserWindow }, { u, x, y }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => { try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; } });
      if (!tab) continue;
      const b = (await tab.view.webContents.capturePage({ x, y, width: 1, height: 1 })).toBitmap();
      return (b[0] + b[1] + b[2]) / 3;
    }
    return null;
  }, { u: page.url(), x, y });
}

test('r2 la bolla della chat al piano più alto resta scura come il resto della pagina col menu aperto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html style="filter:invert(1) hue-rotate(180deg)">
    <body style="padding:40px;background:#fff;color:#000"><h1>Pagina in tema scuro</h1>
    <div id="bolla" style="position:fixed;right:20px;bottom:20px;width:120px;height:60px;background:#fd4;z-index:2147483647"></div>
    <input id="campo" style="width:320px;font-size:16px"></body></html>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  const b = await page.locator('#bolla').boundingBox();
  const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
  await expect.poll(() => luce(app, page, x, y)).toBeLessThan(110);
  const chiusa = await luce(app, page, x, y);

  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toBeVisible();
  await page.waitForTimeout(400);
  const aperta = await luce(app, page, x, y);
  await page.screenshot({ path: 'tests/.shots/589-11-g3-r2-bolla.png' });
  expect(Math.abs(aperta - chiusa), `la bolla cambia colore col menu aperto (${chiusa} → ${aperta})`).toBeLessThan(25);
});
