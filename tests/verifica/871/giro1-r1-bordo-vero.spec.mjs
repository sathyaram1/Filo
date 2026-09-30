// #871 verifica giro 1, rilievo 1: col puntatore VERO (XTest sullo schermo virtuale) e la finestra
// com'è a ogni avvio, fermarsi sul bordo sinistro apre la barra e il clic sulla striscia pure.
// Il mouse di Playwright entra dritto nella vista della barra e salta la scelta del sistema.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { statoBarra } from '../../helpers/barra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const XTEST = `
import ctypes, sys, time
x11 = ctypes.cdll.LoadLibrary('libX11.so.6'); xt = ctypes.cdll.LoadLibrary('libXtst.so.6')
x11.XOpenDisplay.restype = ctypes.c_void_p
d = ctypes.c_void_p(x11.XOpenDisplay(None))
for s in sys.argv[1].split(';'):
    p = s.strip().split(':')
    if p[0] == 'move': xt.XTestFakeMotionEvent(d, -1, int(float(p[1])), int(float(p[2])), 0)
    elif p[0] == 'wait': time.sleep(int(p[1]) / 1000)
    elif p[0] == 'down': xt.XTestFakeButtonEvent(d, 1, 1, 0)
    elif p[0] == 'up': xt.XTestFakeButtonEvent(d, 1, 0, 0)
    x11.XFlush(d)
x11.XCloseDisplay(d)
`;
const puntatore = (passi) => execFileSync('python3', ['-c', XTEST, passi], { env: process.env });
const xtestDisponibile = () => {
  if (process.platform !== 'linux' || !process.env.DISPLAY) return false;
  if (!existsSync('/usr/lib/x86_64-linux-gnu/libXtst.so.6') && !existsSync('/usr/lib/libXtst.so.6')) return false;
  try { execFileSync('python3', ['-c', 'import ctypes'], { stdio: 'ignore' }); return true; } catch (_) { return false; }
};

const SITO = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <h1>Una pagina qualunque</h1><p>Testo.</p></body></html>`;

test('puntatore vero, finestra non massimizzata: fermo sul bordo sinistro apre la barra, e il clic sulla striscia pure', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-barra-vera-');
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(SITO); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/sito`;
  const env = { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_VISIBLE: '1' };
  delete env.FILO_HIDE_WINDOW;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await statoBarra(app))?.bounds?.width ?? 0, { timeout: 10_000 }).toBe(4);
    await pausa(800);
    const { cb, scala, max } = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return { cb: w.getContentBounds(), scala: screen.getPrimaryDisplay().scaleFactor, max: w.isMaximized() };
    });
    // La finestra com'è a ogni avvio di Filo: non massimizzata.
    expect(max).toBe(false);
    const px = (v) => Math.round(v * scala);
    const y = px(cb.y + 320);
    const x0 = px(cb.x);

    // Il puntatore arriva dal centro della pagina e si ferma contro il bordo sinistro.
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + 2}:${y};wait:40;move:${x0 + 1}:${y + 2};wait:40;move:${x0}:${y + 4};wait:800`);
    await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 2000 }).toBe(true);

    puntatore(`move:${x0 + px(600)}:${y};wait:1000`);
    await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 3000 }).toBe(false);
    await pausa(400);

    // Il clic sulla striscia che si vede.
    puntatore(`move:${x0 + 1}:${y + 60};wait:60;down;wait:40;up;wait:400`);
    await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 2000 }).toBe(true);
  } finally {
    await chiudiApp(app);
    try { server.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
