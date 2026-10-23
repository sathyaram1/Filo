// Verifica #1343 giro 12, rilievo 2: a schermo intero il quadrato fra le schede scoperte dal bordo in alto fa qualcosa:
// la finestra è già a tutto schermo, quindi chi lo preme vuole uscire dallo schermo intero.

import { test, expect } from '../../fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const tmEval = (app, fn, arg) => app.evaluate(({ BrowserWindow }, a) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  // eslint-disable-next-line no-new-func
  return new Function('tm', 'arg', a.fn)(tm, a.arg);
}, { fn, arg });
const sito = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="margin:0;padding:40px;height:1400px"><h1>${t}</h1></body></html>`;

test('r2 il quadrato fra le schede scoperte a schermo intero fa uscire dallo schermo intero', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, sito('Prima'));
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await pausa(600);
  await page.mouse.move(400, 200);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(() => tmEval(app, 'return !!tm.schedeInAlto.visibili')).toBe(true);
  const max = shell.locator('#win-max');
  await expect(max).toBeVisible();
  const box = await max.boundingBox();
  await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await max.click();
  await expect.poll(() => tmEval(app, 'return !!tm.contentFullscreen'), { timeout: 3000, message: 'il clic toglie lo schermo intero' }).toBe(false);
});
