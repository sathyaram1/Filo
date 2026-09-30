// #871 verifica giro 2, rilievo 1: finestra non massimizzata (com'è a ogni avvio), puntatore VERO (XTest).
// Un lancio veloce contro il bordo, o un ritorno da fuori della finestra, e poi fermo sul bordo: la barra si apre.

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
    x11.XFlush(d)
x11.XCloseDisplay(d)
`;
const puntatore = (passi) => execFileSync('python3', ['-c', XTEST, passi], { env: process.env });
const xtestDisponibile = () => {
  if (process.platform !== 'linux' || !process.env.DISPLAY) return false;
  if (!['/usr/lib/x86_64-linux-gnu/libXtst.so.6', '/usr/lib/aarch64-linux-gnu/libXtst.so.6', '/usr/lib/libXtst.so.6'].some((f) => existsSync(f))) return false;
  try { execFileSync('python3', ['-c', 'import ctypes'], { stdio: 'ignore' }); return true; } catch (_) { return false; }
};

const SITO = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <h1>Una pagina qualunque</h1><p>Testo.</p></body></html>`;

async function avvia(xFinestra) {
  const userData = cartellaTemporanea('filo-v871-lancio-');
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(SITO); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/sito`;
  const env = { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_VISIBLE: '1' };
  delete env.FILO_HIDE_WINDOW;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await statoBarra(app))?.bounds?.width ?? 0, { timeout: 10_000 }).toBe(4);
  await app.evaluate(({ BrowserWindow }, x) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x, y: 40, width: 1100, height: 800 }), xFinestra);
  await pausa(900);
  const { cb, scala, max } = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return { cb: w.getContentBounds(), scala: screen.getPrimaryDisplay().scaleFactor, max: w.isMaximized() };
  });
  const px = (v) => Math.round(v * scala);
  const chiudi = async () => {
    await chiudiApp(app);
    try { server.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  };
  return { app, max, x0: px(cb.x), y: px(cb.y + 320), px, chiudi };
}

const aperta = async (app) => (await statoBarra(app)).aperta;

test('finestra accostata al bordo dello schermo: un lancio veloce contro il bordo, poi fermo, apre la barra', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  const { app, max, x0, y, px, chiudi } = await avvia(0);
  try {
    expect(max).toBe(false);
    // Un lancio: pochi eventi a 125 al secondo, l'ultimo nella pagina a qualche decina di pixel dal bordo.
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + px(250)}:${y};wait:8;move:${x0 + px(120)}:${y};wait:8;move:${x0 + px(40)}:${y};wait:8;move:${x0}:${y};wait:900`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
  } finally {
    await chiudi();
  }
});

test('finestra in mezzo allo schermo: il puntatore sfora fuori a sinistra, torna e si ferma sul bordo: la barra si apre', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  const { app, max, x0, y, px, chiudi } = await avvia(80);
  try {
    expect(max).toBe(false);
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + px(200)}:${y};wait:16;move:${x0 + px(60)}:${y};wait:16;move:${x0 - 30}:${y};wait:16;move:${x0 - 50}:${y};wait:200;move:${x0 - 20}:${y};wait:30;move:${x0 - 8}:${y};wait:30;move:${x0 + 2}:${y};wait:1000`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
  } finally {
    await chiudi();
  }
});
