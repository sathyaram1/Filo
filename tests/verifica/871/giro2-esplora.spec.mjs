// #871 verifica giro 2, esplorazione col puntatore vero (XTest): schede trascinate, selezione, home, schermate.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
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

async function avvia({ tema, temaPrima } = {}) {
  const userData = cartellaTemporanea('filo-v871-');
  if (temaPrima) { mkdirSync(userData, { recursive: true }); writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { theme: temaPrima } })); }
  const server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(SITO.replace('Una pagina qualunque', `Pagina ${req.url}`)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/sito`;
  const env = { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_VISIBLE: '1' };
  delete env.FILO_HIDE_WINDOW;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env, colorScheme: (temaPrima || tema) === 'dark' ? 'dark' : 'light' });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  if (tema) await app.evaluate(async (_, t) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { theme: t } }, { url: 'filo://preferences/preferences.html' }), tema).catch((e) => console.log('tema', e.message));
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

for (const sx of [0, 80]) {
  test(`esplora: come si arriva al bordo, finestra a x=${sx}`, async () => {
    test.setTimeout(120_000);
    const { app, misure, chiudi } = await avvia();
    try {
      await app.evaluate(({ BrowserWindow }, x) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x, y: 40, width: 1100, height: 800 }), sx);
      await pausa(900);
      const { cb, scala } = await misure();
      const px = (v) => Math.round(v * scala);
      const x0 = px(cb.x); const y = px(cb.y + 320);
      const varianti = {
        'da 30 a 0 in 20ms': `move:${x0 + 400}:${y};wait:150;move:${x0 + 30}:${y};wait:20;move:${x0}:${y + 2};wait:900`,
        'da 30 a 0 in 100ms': `move:${x0 + 400}:${y};wait:150;move:${x0 + 30}:${y};wait:100;move:${x0}:${y + 2};wait:900`,
        'lancio a 125Hz': `move:${x0 + 400}:${y};wait:150;move:${x0 + 250}:${y};wait:8;move:${x0 + 120}:${y};wait:8;move:${x0 + 40}:${y};wait:8;move:${x0}:${y};wait:900`,
        'lancio a 125Hz fino a 2': `move:${x0 + 400}:${y};wait:150;move:${x0 + 250}:${y};wait:8;move:${x0 + 120}:${y};wait:8;move:${x0 + 40}:${y};wait:8;move:${x0 + 2}:${y};wait:900`,
        'salto diretto': `move:${x0 + 400}:${y};wait:150;move:${x0}:${y};wait:900`,
        'lento a 60Hz': `move:${x0 + 400}:${y};wait:150;move:${x0 + 200}:${y};wait:16;move:${x0 + 100}:${y};wait:16;move:${x0 + 50}:${y};wait:16;move:${x0 + 30}:${y};wait:16;move:${x0 + 20}:${y};wait:16;move:${x0 + 10}:${y};wait:16;move:${x0 + 3}:${y};wait:16;move:${x0}:${y};wait:900`,
      };
      for (const [nome, passi] of Object.entries(varianti)) {
        puntatore(passi);
        console.log(`x=${sx}`, nome, ': aperta=', await aperta(app));
        await comanda(app, 'chiudi');
        puntatore(`move:${x0 + 600}:${y};wait:700`);
      }
    } finally {
      await chiudi();
    }
  });
}

test('esplora: oltre il bordo e ritorno, finestra a x=80', async () => {
  test.setTimeout(120_000);
  const { app, misure, chiudi } = await avvia();
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x: 80, y: 40, width: 1100, height: 800 }));
    await pausa(900);
    const { cb, scala } = await misure();
    const px = (v) => Math.round(v * scala);
    const x0 = px(cb.x); const y = px(cb.y + 320);
    const varianti = {
      'oltre e ritorno lento a 2': `move:${x0 + 400}:${y};wait:150;move:${x0 + 200}:${y};wait:16;move:${x0 + 60}:${y};wait:16;move:${x0 - 30}:${y};wait:16;move:${x0 - 50}:${y};wait:200;move:${x0 - 20}:${y};wait:30;move:${x0 - 8}:${y};wait:30;move:${x0 - 2}:${y};wait:30;move:${x0 + 2}:${y};wait:1000`,
      'da fuori a 1': `move:${x0 - 60}:${y};wait:300;move:${x0 - 30}:${y};wait:16;move:${x0 - 10}:${y};wait:16;move:${x0 + 1}:${y};wait:1000`,
      'da fuori a 1, poi su e giù sul bordo': `move:${x0 - 60}:${y};wait:300;move:${x0 + 1}:${y};wait:200;move:${x0 + 1}:${y + 20};wait:100;move:${x0 + 2}:${y + 40};wait:1000`,
      'striscia massimizzata simulata: da dentro, poi giù lungo il bordo': `move:${x0 + 300}:${y};wait:150;move:${x0 + 40}:${y};wait:8;move:${x0 + 2}:${y};wait:100;move:${x0 + 2}:${y + 30};wait:100;move:${x0 + 1}:${y + 60};wait:1000`,
    };
    for (const [nome, passi] of Object.entries(varianti)) {
      puntatore(passi);
      console.log(nome, ': aperta=', await aperta(app));
      await comanda(app, 'chiudi');
      puntatore(`move:${x0 + 600}:${y};wait:700`);
    }
  } finally {
    await chiudi();
  }
});

for (const tema of ['light', 'dark']) {
  test(`esplora: schermate barra aperta (${tema})`, async () => {
    test.setTimeout(120_000);
    const { app, misure, chiudi } = await avvia({ temaPrima: tema });
    const sc = process.env.FILO_TEST_SCALE || '1';
    try {
      await comanda(app, 'clic');
      const barra = await barraPage(app);
      await pausa(600);
      const { cb, scala } = await misure();
      const px = (v) => Math.round(v * scala);
      const vb = (await statoBarra(app)).bounds;
      const r = await barra.evaluate(() => [...document.querySelectorAll('#nav .ico, #fisse .ico, #ora')].map((b) => { const q = b.getBoundingClientRect(); return { id: b.dataset.id || b.dataset.comando || b.id, x: q.left + q.width / 2, y: q.top + q.height / 2 }; }));
      const reload = r.find((i) => i.id === 'reload');
      puntatore(`move:${px(cb.x + vb.x + reload.x)}:${px(cb.y + vb.y + reload.y)};wait:900`);
      scatta(`${tema}-s${sc}-sito-aperta`);
      const ora = r.find((i) => i.id === 'ora');
      puntatore(`move:${px(cb.x + vb.x + ora.x)}:${px(cb.y + vb.y + ora.y)};wait:900`);
      scatta(`${tema}-s${sc}-sito-ora`);
      await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); w._filoTabs.navigate(w._filoTabs.activeId, 'filo://newtab/'); });
      await pausa(2500);
      await comanda(app, 'clic');
      await pausa(600);
      const home = r.find((i) => i.id === 'home');
      puntatore(`move:${px(cb.x + vb.x + home.x)}:${px(cb.y + vb.y + home.y)};wait:900`);
      scatta(`${tema}-s${sc}-home-aperta`);
      await comanda(app, 'chiudi');
      puntatore(`move:${px(cb.x + 600)}:${px(cb.y + 400)};wait:900`);
      scatta(`${tema}-s${sc}-home-chiusa`);
    } finally {
      await chiudi();
    }
  });
}

test('esplora: tema scuro nella shell e nella barra', async () => {
  test.setTimeout(60_000);
  const { app, shell, chiudi } = await avvia({ temaPrima: 'dark' });
  try {
    await comanda(app, 'clic');
    const barra = await barraPage(app);
    await pausa(800);
    const s = await shell.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches, tabBg: getComputedStyle(document.documentElement).getPropertyValue('--tab-bg'), tabActive: getComputedStyle(document.documentElement).getPropertyValue('--tab-active'), inline: document.documentElement.getAttribute('style'), row: getComputedStyle(document.querySelector('.tab-row') || document.body).backgroundColor }));
    const b = await barra.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches, bg: getComputedStyle(document.getElementById('pannello')).backgroundColor, inline: document.documentElement.getAttribute('style') }));
    const tema = await app.evaluate(({ nativeTheme }) => ({ src: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors }));
    console.log('NATIVO', JSON.stringify(tema));
    console.log('SHELL', JSON.stringify(s));
    console.log('BARRA', JSON.stringify(b));
  } finally {
    await chiudi();
  }
});

test('esplora: il suggerimento al passaggio sulle icone della barra', async () => {
  test.setTimeout(60_000);
  const { app, misure, chiudi } = await avvia();
  try {
    await comanda(app, 'clic');
    const barra = await barraPage(app);
    await pausa(600);
    const { cb, scala } = await misure();
    const px = (v) => Math.round(v * scala);
    const vb = (await statoBarra(app)).bounds;
    const r = await barra.evaluate(() => [...document.querySelectorAll('#nav .ico, #fisse .ico, #ora')].map((b) => { const q = b.getBoundingClientRect(); return { id: b.dataset.id || b.dataset.comando || b.id, x: q.left + q.width / 2, y: q.top + q.height / 2 }; }));
    for (const id of ['back', 'reload', 'ora', 'history', 'settings']) {
      const i = r.find((k) => k.id === id);
      puntatore(`move:${px(cb.x + vb.x + i.x)}:${px(cb.y + vb.y + i.y)};wait:800`);
      const tip = await app.evaluate(async ({ BrowserWindow }) => {
        const out = [];
        for (const w of BrowserWindow.getAllWindows()) {
          if (w._filoTabs || !w.isVisible()) continue;
          let t = '';
          try { t = await w.webContents.executeJavaScript("(document.getElementById('tip')||{}).textContent||''"); } catch (_) {}
          out.push({ t, b: w.getBounds(), op: w.getOpacity() });
        }
        return out;
      });
      console.log('SUGG', id, JSON.stringify(tip));
      scatta(`sugg-${id}`);
    }
  } finally {
    await chiudi();
  }
});

test('esplora: schermo intero su una pagina scura, la striscia', async () => {
  test.setTimeout(60_000);
  const { app, misure, chiudi } = await avvia();
  try {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); w._filoTabs.navigate(w._filoTabs.activeId, 'data:text/html,<body style="margin:0;background:%23000"><div style="color:%23888;font:40px sans-serif;padding:200px">video</div></body>'); });
    await pausa(1500);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); w._filoTabs.setContentFullscreen(true); });
    await pausa(1500);
    const s = await statoBarra(app);
    console.log('FS', JSON.stringify({ fs: s.schermoIntero, b: s.bounds, alto: s.alto }), JSON.stringify(await misure()));
    scatta('schermo-intero-scuro');
  } finally {
    await chiudi();
  }
});

test('esplora: i menu che la barra apre (Impostazioni, tasto destro) col puntatore vero', async () => {
  test.setTimeout(90_000);
  const { app, misure, chiudi } = await avvia();
  try {
    const { cb, scala } = await misure();
    const px = (v) => Math.round(v * scala);
    const x0 = px(cb.x); const y = px(cb.y + 320);
    const lento = `move:${x0 + 400}:${y};wait:150;move:${x0 + 200}:${y};wait:16;move:${x0 + 100}:${y};wait:16;move:${x0 + 50}:${y};wait:16;move:${x0 + 30}:${y};wait:16;move:${x0 + 20}:${y};wait:16;move:${x0 + 10}:${y};wait:16;move:${x0 + 3}:${y};wait:16;move:${x0}:${y};wait:900`;
    const finestre = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w._filoTabs && w.isVisible()).map((w) => ({ b: w.getBounds(), url: w.webContents.getURL().slice(0, 30) })));
    for (const cosa of ['settings', 'apps', 'account', 'destro-reload']) {
      puntatore(lento);
      console.log(cosa, 'aperta dal bordo', await aperta(app));
      const barra = await barraPage(app);
      const vb = (await statoBarra(app)).bounds;
      const sel = cosa.startsWith('destro') ? '[data-id="reload"]' : `[data-comando="${cosa}"]`;
      const r = await barra.evaluate((s) => { const q = document.querySelector(s).getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; }, sel);
      const bx = px(cb.x + vb.x + r.x); const by = px(cb.y + vb.y + r.y);
      if (cosa.startsWith('destro')) {
        execFileSync('python3', ['-c', XTEST.replace("xt.XTestFakeButtonEvent(d, 1, 1, 0)", "xt.XTestFakeButtonEvent(d, 3, 1, 0)").replace("xt.XTestFakeButtonEvent(d, 1, 0, 0)", "xt.XTestFakeButtonEvent(d, 3, 0, 0)"), `move:${bx}:${by};wait:200;down;wait:40;up;wait:500`], { env: process.env });
      } else {
        puntatore(`move:${bx}:${by};wait:200;down;wait:40;up;wait:500`);
      }
      const f = await finestre();
      console.log(cosa, 'finestre', JSON.stringify(f));
      const menu = f.find((w) => w.b.width > 120) || f[0];
      if (menu) {
        puntatore(`move:${bx + 30}:${by};wait:30;move:${menu.b.x + 20}:${menu.b.y + 20};wait:30;move:${menu.b.x + 40}:${menu.b.y + 30};wait:1200`);
        console.log(cosa, 'sul menu: barra aperta=', await aperta(app), 'menu ancora visibile=', (await finestre()).length);
        scatta(`menu-${cosa}`);
      }
      await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (!w._filoTabs && w.isVisible()) w.hide(); });
      await comanda(app, 'chiudi');
      puntatore(`move:${x0 + 600}:${y};wait:800`);
    }
  } finally {
    await chiudi();
  }
});

test('esplora: tutte le icone nella barra con la finestra bassa', async () => {
  test.setTimeout(60_000);
  const { app, chiudi } = await avvia();
  try {
    const ids = ['translate', 'screenshot', 'screenshotCrop', 'transcribe', 'share', 'saveForLater', 'qrCode', 'colorPicker', 'newTab', 'openOptions', 'editorApp'];
    for (const id of ids) await app.evaluate(async (_, i) => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: i, target: 'bar' }, {}), id);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x: 80, y: 40, width: 900, height: 520 }));
    await pausa(800);
    await comanda(app, 'clic');
    const barra = await barraPage(app);
    await pausa(800);
    const m = await barra.evaluate(() => { const n = document.getElementById('nav'); return { sh: n.scrollHeight, ch: n.clientHeight, icone: n.querySelectorAll('.ico').length, h: innerHeight }; });
    console.log('NAV', JSON.stringify(m), JSON.stringify((await statoBarra(app)).bar));
    scatta('tutte-le-icone');
  } finally {
    await chiudi();
  }
});

test('esplora: menu del tasto destro aperto vicino al bordo sinistro e trascinamento', async () => {
  test.setTimeout(60_000);
  const { app, url, chiudi } = await avvia();
  try {
    const page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.mouse.click(20, 130, { button: 'right' });
    const icona = page.locator('.sn-menu [data-sn-icon-id="translate"]').first();
    await expect(icona).toBeVisible();
    const menu = await page.locator('.sn-menu').first().boundingBox();
    const box = await icona.boundingBox();
    console.log('MENU', JSON.stringify(menu), 'ICONA', JSON.stringify(box));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 2, { steps: 4 });
    await pausa(600);
    console.log('DURANTE', JSON.stringify(await statoBarra(app)));
    scatta('menu-vicino-al-bordo-trascina');
    await page.mouse.up();
  } finally {
    await chiudi();
  }
});
