// Esplorazione giro 13: a schermo intero, trascinando un collegamento verso il bordo alto le schede arrivano?
import { execFileSync } from 'node:child_process';
import { test, expect } from '../../fixtures/electron.mjs';

let xdotool = false;
try { execFileSync('xdotool', ['version'], { stdio: 'ignore' }); xdotool = !!process.env.DISPLAY; } catch (_) {}
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

test('esplora: trascino un collegamento al bordo alto a schermo intero', async ({ app, openTab, testServer }) => {
  test.skip(!xdotool, 'serve xdotool');
  await testServer.openReady(openTab, '<!doctype html><title>Prima</title><h1>Prima</h1>');
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Seconda</title></head><body style="margin:0;font:20px sans-serif">
    <div style="height:300px"></div><a id="l" href="https://example.org/" style="margin-left:300px">collegamento da portare</a></body></html>`);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).focus());
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await pausa(1500);
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).getContentBounds());
  const r = await page.locator('#l').boundingBox();
  const x = cb.x + r.x + 20, y = cb.y + r.y + 8;
  xdo('mousemove', x, y); await pausa(300);
  xdo('mousedown', 1); await pausa(100);
  for (let i = 1; i <= 15; i++) { xdo('mousemove', x, Math.round(y - (y - cb.y) * i / 15)); await pausa(30); }
  xdo('mousemove', x, cb.y);
  await pausa(1500);
  xdo('mousemove', x, cb.y);
  await pausa(800);
  const vis = await tmEval(app, 'return !!tm.schedeInAlto.visibili');
  xdo('mouseup', 1);
  console.log('schede durante il trascinamento', vis);
});
