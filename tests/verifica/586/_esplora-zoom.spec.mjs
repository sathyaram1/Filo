import { test } from '../../fixtures/electron.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test('dove nasce il menu con lo zoom sul documento', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html style="zoom:.8"><title>Zoom</title><body><input id="c" style="margin:200px;width:300px"></body></html>`);
  const box = await page.locator('#c').boundingBox();
  const x = box.x + 30, y = box.y + 8;
  await page.mouse.click(x, y, { button: 'right' });
  await sleep(600);
  console.log('ESITO', JSON.stringify({ x, y, menu: await page.evaluate(() => { const m = document.querySelector('.sn-menu'); const r = m.getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, styleLeft: m.style.left, zoom: m.currentCSSZoom }; }) }));
  await page.screenshot({ path: 'tests/.shots/586-giro18-zoom.png' });
});
