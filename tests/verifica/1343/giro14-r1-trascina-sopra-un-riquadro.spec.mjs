// Verifica #1343 giro 14, rilievo 1: a schermo intero un collegamento trascinato contro il bordo alto, sopra un riquadro
// di un altro sito in cima alla pagina, fa arrivare le schede come su una pagina normale. Serve xdotool su X11.

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

async function trascinaInAlto(app, page) {
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
  return visibili;
}

const LINK = '<a id="l" href="https://example.org/" style="margin-left:300px">collegamento da portare</a>';

test('r1 a schermo intero un collegamento trascinato contro il bordo alto, sopra un riquadro di un altro sito, fa arrivare le schede', async ({ app, openTab, testServer }) => {
  test.skip(!xdotool, 'serve xdotool su X11');
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;background:#cde;height:100vh">Pubblicità</body></html>', { pubblico: true });
  await testServer.openReady(openTab, '<!doctype html><title>Prima</title><h1>Prima</h1>');
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Seconda</title></head><body style="margin:0;font:20px sans-serif">
    <iframe src="${dentro}" style="display:block;width:100%;height:250px;border:0"></iframe><div style="height:150px"></div>${LINK}</body></html>`);
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  expect(await trascinaInAlto(app, page), 'col collegamento trascinato sul bordo alto le schede arrivano').toBe(true);
});
