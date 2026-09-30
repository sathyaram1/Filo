// #871 verifica giro 2, esplorazione col puntatore vero (XTest): schede trascinate, selezione, home, schermate.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { statoBarra, barraPage } from '../../helpers/barra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots', 'v871g2');
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
const scatta = (nome) => { mkdirSync(SHOTS, { recursive: true }); try { execFileSync('scrot', ['-o', join(SHOTS, `${nome}.png`)], { env: process.env }); } catch (e) { console.log('scrot', e.message); } };

const SITO = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <h1>Una pagina qualunque</h1><p id="t">Testo da selezionare, lungo abbastanza per trascinare il mouse sopra fino al bordo della finestra, e anche di più.</p>
  <p><a href="/due">vai alla seconda</a></p></body></html>`;

async function avvia({ tema } = {}) {
  const userData = cartellaTemporanea('filo-v871-');
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(SITO.replace('Una pagina qualunque', `Pagina ${req.url}`)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/sito`;
  const env = { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_VISIBLE: '1' };
  delete env.FILO_HIDE_WINDOW;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  if (tema) await app.evaluate(async (_, t) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { theme: t } }, {}), tema).catch((e) => console.log('tema', e.message));
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await statoBarra(app))?.bounds?.width ?? 0, { timeout: 10_000 }).toBe(4);
  await pausa(900);
  const misure = async () => app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return { cb: w.getContentBounds(), scala: screen.getPrimaryDisplay().scaleFactor, max: w.isMaximized(), alto: w._filoTabs._altezzaCornice() };
  });
  const chiudi = async () => {
    await chiudiApp(app);
    try { server.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  };
  return { app, shell, url, misure, chiudi };
}

const aperta = async (app) => (await statoBarra(app)).aperta;

test('esplora: trascinare una scheda e selezionare testo fino al bordo', async () => {
  test.setTimeout(120_000);
  const { app, shell, misure, chiudi } = await avvia();
  try {
    const { cb, scala } = await misure();
    const px = (v) => Math.round(v * scala);
    const tab = await shell.evaluate(() => { const r = document.querySelector('.tab.active').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const tx = px(cb.x + tab.x); const ty = px(cb.y + tab.y);
    const x0 = px(cb.x); const y = px(cb.y + 320);
    console.log('win', JSON.stringify(cb), 'tab', tx, ty);
    // Scheda trascinata giù e contro il bordo sinistro, tenuta lì.
    puntatore(`move:${tx}:${ty};wait:100;down;wait:80;move:${tx - 10}:${ty + 5};wait:30;move:${tx - 40}:${ty + 60};wait:30;move:${x0 + 60}:${y};wait:30;move:${x0 + 2}:${y};wait:30;move:${x0 + 1}:${y + 3};wait:30;move:${x0}:${y + 6};wait:1200`);
    console.log('scheda tenuta sul bordo: aperta=', await aperta(app));
    scatta('scheda-trascinata');
    puntatore(`up;wait:600`);
    console.log('scheda rilasciata sul bordo: aperta=', await aperta(app), 'schede', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => x._filoTabs).map((w) => w._filoTabs.tabs.length)));
    puntatore(`move:${x0 + px(500)}:${y};wait:1000`);
    await comanda(app, 'chiudi');
    await pausa(500);
    // Selezione di testo trascinata fino al bordo.
    const ty2 = px(cb.y + (await misure()).alto + 70);
    puntatore(`move:${x0 + px(600)}:${ty2};wait:100;down;wait:60;move:${x0 + px(300)}:${ty2};wait:30;move:${x0 + 2}:${ty2 + 4};wait:30;move:${x0}:${ty2 + 8};wait:1200`);
    console.log('selezione tenuta sul bordo: aperta=', await aperta(app));
    puntatore(`up;wait:900`);
    console.log('selezione rilasciata sul bordo, fermo: aperta=', await aperta(app));
  } finally {
    await chiudi();
  }
});

async function comanda(app, c) {
  return app.evaluate(({ BrowserWindow }, cc) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    if (cc === 'chiudi') w._filoTabs.barra.chiudi(); else w._filoTabs.barra.apri(cc);
  }, c);
}

for (const tema of ['light', 'dark']) {
  test(`esplora: massimizzata, spinta, passaggio sulle icone, home (${tema})`, async () => {
    test.setTimeout(120_000);
    const { app, misure, chiudi } = await avvia({ tema });
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).maximize());
      await pausa(1200);
      const { cb, scala, max } = await misure();
      const px = (v) => Math.round(v * scala);
      const x0 = px(cb.x); const y = px(cb.y + 320);
      console.log(tema, 'max', max, JSON.stringify(cb));
      scatta(`${tema}-chiusa`);
      puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + 30}:${y};wait:20;move:${x0}:${y + 2};wait:900`);
      console.log(tema, 'spinta massimizzata: aperta=', await aperta(app));
      const barra = await barraPage(app);
      const r = await barra.evaluate(() => [...document.querySelectorAll('#nav .ico, #fisse .ico')].map((b) => { const q = b.getBoundingClientRect(); return { id: b.dataset.id || b.dataset.comando, x: q.left + q.width / 2, y: q.top + q.height / 2, spenta: b.getAttribute('aria-disabled') }; }));
      const vb = (await statoBarra(app)).bounds;
      console.log(tema, 'icone', JSON.stringify(r));
      const home = r.find((i) => i.id === 'reload');
      puntatore(`move:${px(cb.x + vb.x + home.x)}:${px(cb.y + vb.y + home.y)};wait:900`);
      scatta(`${tema}-aperta-suggerimento`);
      console.log(tema, 'sopra ricarica: aperta=', await aperta(app));
      // Di corsa sul bordo: su e giù e via.
      puntatore(`move:${x0 + px(500)}:${y};wait:1200`);
      console.log(tema, 'uscita: aperta=', await aperta(app));
      puntatore(`move:${x0 + px(300)}:${y};wait:50;move:${x0}:${y};wait:60;move:${x0 + px(300)}:${y + 10};wait:800`);
      console.log(tema, 'di corsa: aperta=', await aperta(app));
      // Sulla home di Filo.
      await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); w._filoTabs.navigate(w._filoTabs.activeId, 'filo://newtab/'); });
      await pausa(2500);
      const m2 = await misure();
      const y2 = px(m2.cb.y + m2.alto + 300);
      scatta(`${tema}-home-chiusa`);
      puntatore(`move:${x0 + px(400)}:${y2};wait:150;move:${x0 + 30}:${y2};wait:20;move:${x0}:${y2 + 2};wait:900`);
      console.log(tema, 'spinta sulla home: aperta=', await aperta(app));
      scatta(`${tema}-home-aperta`);
    } finally {
      await chiudi();
    }
  });
}
