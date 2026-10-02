// #686.1 giro 9, rilievo 2: un clic nell'editor che la pagina riempie in un riquadro, all'altezza del riquadro dello zoom,
// vale come clic sul numero dello zoom: la modalità resta aperta e quello che si batte finisce nello zoom, non nell'editor.

import { test, expect } from '../../fixtures/electron.mjs';

async function percentOf(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.getZoomFactor();
    }
    return null;
  }, url);
  return f == null ? null : Math.round(f * 100);
}

test('a modalità aperta, un clic nella prima riga dell\'editor chiude lo zoom e il testo battuto va nell\'editor', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:2000px">
    <h1 style="margin:0;height:300px">sopra</h1>
    <iframe id=ed style="border:0;position:absolute;left:0;top:300px;width:100vw;height:300px"></iframe>
    <script>const d = document.getElementById('ed').contentDocument; d.open(); d.write('<!doctype html><html><body style="margin:0;height:300px;font:16px sans-serif"><p>prima riga</p></body></html>'); d.close(); d.designMode = 'on';</script>
    </body></html>`);
  await page.mouse.move(400, 450);
  await page.mouse.click(400, 150, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  const box = await page.locator('#__filo-zoom-percent').boundingBox();
  // Lo stesso punto del numero, ma dentro l'editor: 300 px più in basso.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 300);
  await expect(page.locator('#__filo-zoom-badge'), 'il clic nell\'editor non chiude la modalità').toHaveCount(0);
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  expect(await percentOf(app, page), 'il testo battuto nell\'editor ha cambiato lo zoom').toBe(100);
  expect(await page.evaluate(() => document.getElementById('ed').contentDocument.body.textContent)).toContain('30');
});
