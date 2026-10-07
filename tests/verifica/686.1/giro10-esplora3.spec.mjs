// #686.1 giro 10, esplorazione: dopo il campo della percentuale, i tasti tornano alla pagina in ogni modo di chiuderlo.

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
async function tasti(app, page, testo) {
  const url = await page.evaluate(() => location.href);
  await app.evaluate(({ webContents }, { u, testo }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      for (const ch of testo) {
        wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
        wc.sendInputEvent({ type: 'char', keyCode: ch });
        wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
      }
    }
  }, { u: url, testo });
}

const PAGINA = `<!doctype html><html><body style="margin:0;height:3000px">
  <input id=q style="position:absolute;left:40px;top:300px;width:300px;font:20px sans-serif">
  <h1 style="margin-top:100px">pagina</h1></body></html>`;

for (const modo of ['invio', 'clic fuori', 'rotella premuta', 'esc', 'tab']) {
  test(`chiuso con ${modo}: i tasti tornano alla pagina`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, PAGINA);
    await page.mouse.click(600, 200, { button: 'middle' });
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    await page.locator('#__filo-zoom-percent').click();
    await tasti(app, page, '150');
    if (modo === 'invio') await tasti(app, page, '\r');
    if (modo === 'clic fuori') await page.mouse.click(600, 200);
    if (modo === 'rotella premuta') await page.mouse.click(600, 200, { button: 'middle' });
    if (modo === 'esc') {
      const url = await page.evaluate(() => location.href);
      await app.evaluate(({ webContents }, u) => {
        for (const wc of webContents.getAllWebContents()) {
          if (wc.getURL() !== u) continue;
          wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
          wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        }
      }, url);
    }
    if (modo === 'tab') await tasti(app, page, '\t');
    await page.waitForTimeout(400);
    const z = await percentOf(app, page);
    console.log(modo, 'zoom', z);
    if (await page.locator('#__filo-zoom-badge').count()) await page.mouse.click(600, 200);
    await page.waitForTimeout(200);
    const box = await page.locator('#q').boundingBox();
    await page.mouse.click(box.x + 10, box.y + box.height / 2);
    await tasti(app, page, 'ciao');
    await expect(page.locator('#q')).toHaveValue('ciao');
  });
}
