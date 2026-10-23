// Verifica #1343 giro 12, rilievo 1: a schermo intero, con le schede scoperte, un clic dato sulla pagina con i tempi di
// una mano vera (arrivo, poi la pressione) lo riceve l'elemento sotto il puntatore: le schede non se ne vanno a tasto giù.

import { test, expect } from '../../fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const tmEval = (app, fn, arg) => app.evaluate(({ BrowserWindow }, a) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  // eslint-disable-next-line no-new-func
  return new Function('tm', 'arg', a.fn)(tm, a.arg);
}, { fn, arg });
const cima = (app) => tmEval(app, 'const t = tm.tabs.find((x) => x.id === tm.activeId); return { y: t.view.getBounds().y, fila: tm.tabRowHeight };');

test('r1 con le schede scoperte a schermo intero un clic su un collegamento vicino alla cima lo segue', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif;height:1400px">
    <div style="height:100px"></div><a id="link" href="#arrivato" style="display:inline-block;height:20px;margin-left:200px">vai al capitolo</a>
    <div style="height:400px"></div><h2 id="arrivato">Capitolo</h2></body></html>`);
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await expect.poll(async () => (await cima(app)).y).toBe(0);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => { const c = await cima(app); return c.y === c.fila; }).toBe(true);
  await pausa(300);

  const box = await page.locator('#link').boundingBox();
  const x = Math.round(box.x + 20);
  const y = Math.round(box.y + 10);
  // Il puntatore resta fermo sullo schermo: se la pagina sale a tasto giù, il rilascio cade più in basso nella pagina.
  const allaPagina = (ev) => tmEval(app, 'tm.tabs.find((x) => x.id === tm.activeId).view.webContents.sendInputEvent(arg)', ev);
  await allaPagina({ type: 'mouseMove', x, y });
  await pausa(300);
  const prima = (await cima(app)).y;
  await allaPagina({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await pausa(120);
  const salita = prima - (await cima(app)).y;
  await allaPagina({ type: 'mouseUp', x, y: y + salita, button: 'left', clickCount: 1 });
  expect(salita, 'a tasto giù la pagina non si sposta sotto il puntatore').toBe(0);
  await expect.poll(() => page.evaluate(() => location.hash), { timeout: 3000 }).toBe('#arrivato');
});
