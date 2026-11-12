// Verifica #1343 giro 14, rilievo 2: a schermo intero, scendendo in fretta dalle schede scoperte al bordo sinistro, la
// barra laterale si apre e non si sposta sotto il puntatore quando le schede se ne vanno. Serve xdotool su X11.

import { execFileSync } from 'node:child_process';
import { test, expect } from '../../fixtures/electron.mjs';
import { statoBarra } from '../../helpers/barra.mjs';

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

test('r2 a schermo intero la barra aperta dal bordo sinistro mentre le schede se ne vanno resta ferma', async ({ app, openTab, testServer }) => {
  test.skip(!xdotool, 'serve xdotool su X11');
  await testServer.openReady(openTab, '<!doctype html><title>Prima</title><h1>Prima</h1>');
  await testServer.openReady(openTab, '<!doctype html><title>Seconda</title><body style="height:2000px"><h1>Seconda</h1></body>');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).focus());
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await pausa(1000);
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs).getContentBounds());
  xdo('mousemove', cb.x + 400, cb.y + 200); await pausa(200);
  for (let i = 1; i <= 8; i++) { xdo('mousemove', cb.x + 400, Math.round(cb.y + 200 - 200 * i / 8)); await pausa(30); }
  await expect.poll(() => tmEval(app, 'return !!tm.schedeInAlto.visibili')).toBe(true);
  // Dalle schede giù sulla pagina e subito contro il bordo sinistro, come chi va dritto alla barra.
  xdo("mousemove", cb.x + 200, cb.y + 150); xdo("mousemove", cb.x, cb.y + 300);
  const log = [];
  for (let i = 0; i < 20; i++) { const s = await statoBarra(app); log.push([s.aperta, s.bounds && s.bounds.y, await tmEval(app, 'return !!tm.schedeInAlto.visibili')]); await pausa(100); }
  const aperte = log.filter((l) => l[0]);
  const ys = new Set(aperte.map((l) => l[1]));
  expect(aperte.length).toBeGreaterThan(0);
  expect([...ys].length, 'la barra aperta non si sposta').toBe(1);
  expect(log.at(-1)[2], 'le schede, lasciate, se ne sono andate').toBe(false);
});
