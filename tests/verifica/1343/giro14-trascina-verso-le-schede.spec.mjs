// Verifica #1343 giro 14, porta del giro 13: a schermo intero, portando un collegamento trascinato contro il bordo alto, le
// schede arrivano: si trascina da una scheda all'altra anche lì. Serve il puntatore vero (xdotool, apt-get install
// xdotool): gli eventi mandati alla scheda non fanno partire un trascinamento, e senza resta una selezione.

import { execFileSync } from 'node:child_process';
import { test, expect } from '../../fixtures/electron.mjs';

let xdotool = false;
try { execFileSync('xdotool', ['version'], { stdio: 'ignore' }); xdotool = process.platform === 'linux' && !!process.env.DISPLAY; } catch (_) {}
const nascosta = process.env.FILO_HIDE_WINDOW;
if (xdotool) delete process.env.FILO_HIDE_WINDOW;
test.afterAll(() => { if (nascosta !== undefined) process.env.FILO_HIDE_WINDOW = nascosta; });
const xdo = (...a) => execFileSync('xdotool', a.map(String));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const tmEval = (app, fn, arg) => app.evaluate(({ BrowserWindow }, a) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  // eslint-disable-next-line no-new-func
  return new Function('tm', 'arg', a.fn)(tm, a.arg);
}, { fn, arg });

test('giro 13: a schermo intero un collegamento trascinato contro il bordo alto fa arrivare le schede', async ({ app, openTab, testServer }) => {
  test.skip(!xdotool, 'serve xdotool su X11');
  await testServer.openReady(openTab, '<!doctype html><title>Prima</title><h1>Prima</h1>');
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Seconda</title></head><body style="margin:0;font:20px sans-serif">
    <div style="height:300px"></div><a id="l" href="https://example.org/" style="margin-left:300px">collegamento da portare</a></body></html>`);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).focus());
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await expect.poll(() => tmEval(app, 'return tm.tabs.find((x) => x.id === tm.activeId).view.getBounds().y')).toBe(0);
  await pausa(800);
  await page.evaluate(() => document.addEventListener('dragstart', () => { window.__trascina = true; }));
  const r = await page.locator('#l').boundingBox();
  const x = Math.round(r.x + 20);
  const y = Math.round(r.y + 8);
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs).getContentBounds());
  xdo('mousemove', cb.x + x, cb.y + y); await pausa(300);
  xdo('mousedown', 1); await pausa(100);
  for (let i = 1; i <= 15; i++) { xdo('mousemove', cb.x + x, Math.round(cb.y + y - y * i / 15)); await pausa(30); }
  await pausa(1500);
  xdo('mousemove', cb.x + x, cb.y);
  await pausa(800);
  const visibili = await tmEval(app, 'return !!tm.schedeInAlto.visibili');
  xdo('mouseup', 1);
  expect(await page.evaluate(() => !!window.__trascina), 'il trascinamento è partito').toBe(true);
  expect(visibili, 'col collegamento trascinato contro il bordo alto le schede arrivano').toBe(true);
});
