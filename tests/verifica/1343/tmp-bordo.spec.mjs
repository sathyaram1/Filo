// Esplorazione giro 13: schede scoperte, poi il puntatore vero va al bordo sinistro e apre la barra.
import { execFileSync } from 'node:child_process';
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra } from '../../helpers/barra.mjs';

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
const sito = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="margin:0;padding:40px;height:1400px"><h1>${t}</h1></body></html>`;

async function mossa(da, a, passi = 10, ms = 20) {
  for (let i = 1; i <= passi; i++) {
    xdo('mousemove', Math.round(da[0] + (a[0] - da[0]) * i / passi), Math.round(da[1] + (a[1] - da[1]) * i / passi));
    await pausa(ms);
  }
}

test('esplora: schede scoperte poi barra dal bordo sinistro', async ({ app, openTab, testServer }) => {
  test.skip(!xdotool, 'serve xdotool');
  await testServer.openReady(openTab, sito('Prima'));
  await testServer.openReady(openTab, sito('Seconda'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).focus());
  await tmEval(app, 'tm.setContentFullscreen(true)');
  await pausa(1500);
  const cb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).getContentBounds());
  console.log('content', JSON.stringify(cb));
  xdo('mousemove', cb.x + 600, cb.y + 300); await pausa(200);
  await mossa([cb.x + 600, cb.y + 300], [cb.x + 600, cb.y], 8);
  await expect.poll(() => tmEval(app, 'return !!tm.schedeInAlto.visibili'), { timeout: 4000 }).toBe(true);
  await pausa(300);
  // Giù verso sinistra, fino al bordo.
  await mossa([cb.x + 600, cb.y], [cb.x, cb.y + 200], 12, 25);
  await pausa(100);
  xdo('mousemove', cb.x, cb.y + 200);
  await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 4000 }).toBe(true);
  const barra = await barraPage(app);
  const s1 = await statoBarra(app);
  const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
  const hx = cb.x + s1.bounds.x + home.x + home.width / 2;
  const hy = cb.y + s1.bounds.y + home.y + home.height / 2;
  await mossa([cb.x, cb.y + 200], [hx, hy], 6, 25);
  const subito = await statoBarra(app);
  await pausa(1500);
  const dopo = await statoBarra(app);
  const schede = await tmEval(app, 'return !!tm.schedeInAlto.visibili');
  console.log('bounds aperta', JSON.stringify(s1.bounds), 'subito', JSON.stringify(subito.bounds), 'dopo', JSON.stringify(dopo.bounds), 'schede', schede, 'aperta', dopo.aperta);
  expect(dopo.bounds.y, 'la barra non si sposta sotto il puntatore').toBe(subito.bounds.y);
});
