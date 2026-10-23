// Verifica #1343 giro 7, rilievo 1: a schermo intero, la barra laterale aperta dalla sua linguetta nella fila delle
// schede non si sposta sotto il puntatore quando le schede se ne vanno: l'icona su cui si mira resta quella.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const sito = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="margin:0;padding:40px;height:1400px"><h1>${t}</h1></body></html>`;

test('r1 a schermo intero la barra aperta dalla linguetta delle schede resta ferma sotto il puntatore', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, sito('Prima'));
  const page = await testServer.openReady(openTab, sito('Seconda'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
  await pausa(800);
  await page.mouse.move(300, 200);
  await page.mouse.move(300, 0, { steps: 4 });
  await expect.poll(async () => (await statoBarra(app)).alto).toBeGreaterThan(0);

  const maniglia = shell.locator('#barra-maniglia');
  const box = await maniglia.boundingBox();
  await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await maniglia.click();
  const barra = await barraPage(app);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pausa(400);
  const prima = await statoBarra(app);

  // Il puntatore scende dalla linguetta nella barra e si ferma su Home: la shell, sotto, lo sente uscire.
  await app.evaluate(({ BrowserWindow }, p) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).webContents.sendInputEvent({ type: 'mouseLeave', x: p.x, y: p.y });
  }, { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height + 4) });
  const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
  const x = home.x + home.width / 2;
  const y = home.y + home.height / 2;
  await barra.mouse.move(x, y, { steps: 3 });
  await pausa(1500);

  // Lo stesso punto dello schermo, nelle coordinate della barra di adesso.
  const dopo = await statoBarra(app);
  const sotto = await barra.evaluate(([px, py]) => {
    const b = document.elementFromPoint(px, py)?.closest('.ico');
    return b ? b.dataset.id : null;
  }, [x, y + (prima.bounds.y - dopo.bounds.y)]);
  expect(dopo.aperta).toBe(true);
  expect(sotto, 'sotto il puntatore fermo c\'è ancora Home, non l\'icona accanto').toBe('home');
});
