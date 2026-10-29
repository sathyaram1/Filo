// #1433 — il pannello degli strumenti dell'Editor col puntatore VERO (XTest sullo schermo virtuale), a finestra non
// massimizzata: gli ultimi pixel del bordo destro li prende il sistema, e lì sta anche la barra di scorrimento del
// foglio. Il mouse di Playwright entra dritto nella pagina e salta tutto questo: qui no. Senza XTest si salta.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const EDITOR = 'filo://editor/editor.html';
const SHOTS = 'tests/.shots';
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
  if (!['/usr/lib/x86_64-linux-gnu/libXtst.so.6', '/usr/lib/aarch64-linux-gnu/libXtst.so.6', '/usr/lib/libXtst.so.6'].some((f) => existsSync(f))) return false;
  try { execFileSync('python3', ['-c', 'import ctypes'], { stdio: 'ignore' }); return true; } catch (_) { return false; }
};

// Filo a schermo, staccato dai bordi, con l'Editor davanti e un documento lungo (la barra di scorrimento lavora).
async function avvia({ bloccato = false } = {}) {
  const userData = cartellaTemporanea('filo-pannello-bordo-');
  const env = { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_VISIBLE: '1' };
  delete env.FILO_HIDE_WINDOW;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  if (bloccato) await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { pannelloDestro: { bloccato: true } } }, { url: 'filo://preferences/preferences.html' }));
  await shell.evaluate((u) => window.filoShell.tabs.open(u), EDITOR);
  let ed = null;
  await expect.poll(() => Boolean(ed = app.windows().find((w) => { try { return w.url().startsWith(EDITOR); } catch (_) { return false; } })), { timeout: 15_000 }).toBe(true);
  await ed.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  await ed.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = Array.from({ length: 80 }, (_, i) => `<p>Riga ${i + 1} del documento, abbastanza lunga da occupare la colonna di testo.</p>`).join('');
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x: 80, y: 40, width: 1100, height: 800 }));
  await pausa(900);
  const { cb, scala, max, alto } = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return { cb: w.getContentBounds(), scala: screen.getPrimaryDisplay().scaleFactor, max: w.isMaximized(), alto: w._filoTabs._altezzaCornice() };
  });
  const px = (v) => Math.round(v * scala);
  const chiudi = async () => {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  };
  // L'ultimo pixel a destra della finestra, e un punto a metà altezza della pagina.
  return { app, ed, max, cb, px, destra: px(cb.x + cb.width) - 1, y: px(cb.y + alto + 300), yFila: px(cb.y + alto / 2), xDentro: px(cb.x + 400), chiudi };
}

const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
const motivo = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t && t.pannelloApp ? t.pannelloApp.motivo : null;
});

test.skip('g1 Aiuto ridotto: dal bordo al pannello', async () => {
  test.skip(!xtestDisponibile(), 'xtest');
  test.setTimeout(90_000);
  const { app, ed, cb, px, destra, y, xDentro, chiudi } = await avvia();
  try {
    await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
    await expect(ed.locator('.sn-sidebar')).toBeVisible();
    await pausa(600);
    await ed.locator('.sn-sidebar-collapse').click();
    await pausa(600);
    puntatore(`move:${xDentro}:${y};wait:300;move:${destra - 1}:${y};wait:40;move:${destra}:${y + 1};wait:800`);
    console.log('G1 aperto dal bordo', await aperto(ed));
    const pan = await ed.locator('.pd-pannello').boundingBox();
    console.log('G1 pannello', JSON.stringify(pan));
    await ed.screenshot({ path: 'tests/.shots/v1433/g1-bordo-ridotto.png' });
    const xPan = px(cb.x + pan.x + pan.width / 2);
    const passi = [];
    for (let i = 1; i <= 12; i++) passi.push(`move:${Math.round(destra + (xPan - destra) * i / 12)}:${y}`, 'wait:60');
    passi.push('wait:600');
    puntatore(passi.join(';'));
    console.log('G1 arrivato sul pannello, aperto', await aperto(ed));
  } finally {
    await chiudi();
  }
});

test.skip('g2 selezione col mouse premuto che arriva al bordo', async () => {
  test.skip(!xtestDisponibile(), 'xtest');
  test.setTimeout(90_000);
  const { app, ed, destra, y, xDentro, chiudi } = await avvia();
  try {
    puntatore(`move:${xDentro}:${y};wait:200;down;wait:80;move:${xDentro + 200}:${y + 10};wait:60;move:${destra - 1}:${y + 20};wait:40;move:${destra}:${y + 20};wait:1000`);
    console.log('G2 con tasto premuto al bordo: aperto', await aperto(ed));
    puntatore('up;wait:400');
    const sel = await ed.evaluate(() => String(getSelection()).length);
    console.log('G2 dopo rilascio: aperto', await aperto(ed), 'selezione', sel);
    await ed.screenshot({ path: 'tests/.shots/v1433/g2-selezione.png' });
  } finally {
    await chiudi();
  }
});

test('g3 pagina web: il bordo destro non apre niente', async () => {
  test.skip(!xtestDisponibile(), 'xtest');
  test.setTimeout(90_000);
  const { app, ed, destra, y, xDentro, chiudi } = await avvia();
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return w._filoTabs.open ? null : null;
    });
    const shell = await primaFinestra(app);
    const http = await import('node:http');
    const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<body style="height:3000px">ciao</body>'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://127.0.0.1:${srv.address().port}/`);
    await pausa(1500);
    puntatore(`move:${xDentro}:${y};wait:300;move:${destra - 1}:${y};wait:40;move:${destra}:${y + 1};wait:1000`);
    const st = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
      return { url: t.view.webContents.getURL().slice(0, 40), pannello: t.pannelloApp || null };
    });
    console.log('G3', JSON.stringify(st));
  } finally {
    await chiudi();
  }
});
