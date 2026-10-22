// Verifica #1343 giro 6, rilievo 3: a schermo intero, con le schede scoperte, un clic su un collegamento della
// pagina lo segue. Il puntatore resta fermo sullo schermo: se la pagina sale fra la pressione e il rilascio, il
// rilascio cade su un altro punto della pagina, ed è lì che lo si manda.

import { test, expect } from '../../fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const cima = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const tm = w._filoTabs;
  return { y: tm.tabs.find((x) => x.id === tm.activeId).view.getBounds().y, fila: tm.tabRowHeight };
});

test('r3 con le schede scoperte a schermo intero un clic su un collegamento della pagina lo segue', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif;height:1400px">
    <div style="height:100px"></div><a id="link" href="#arrivato" style="display:inline-block;height:20px;margin-left:200px">vai al capitolo</a>
    <div style="height:400px"></div><h2 id="arrivato">Capitolo</h2></body></html>`);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true);
  });
  await expect.poll(async () => (await cima(app)).y).toBe(0);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => { const c = await cima(app); return c.y === c.fila; }).toBe(true);

  const box = await page.locator('#link').boundingBox();
  const x = box.x + 20;
  const y = box.y + 10;
  await page.mouse.move(x, y);
  const prima = (await cima(app)).y;
  await page.mouse.down();
  await pausa(80);
  const salita = prima - (await cima(app)).y;
  await page.mouse.up();
  await page.mouse.move(x, y + salita);
  await page.mouse.down();
  await page.mouse.up();
  void salita;
  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 3000 }).toBe('#arrivato');
});
