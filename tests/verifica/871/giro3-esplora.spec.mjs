// #871 giro 3 — esplorazione col puntatore VERO (XTest), finestra non massimizzata come all'avvio.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { barraPage, statoBarra, menuAperto, vociDelMenu, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

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
    elif p[0] == 'rdown': xt.XTestFakeButtonEvent(d, 3, 1, 0)
    elif p[0] == 'rup': xt.XTestFakeButtonEvent(d, 3, 0, 0)
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
  <h1>Una pagina qualunque</h1><p id="p">Testo su cui fare tasto destro, abbastanza lungo da prenderlo.</p>
  <a id="vai" href="/due">vai alla due</a></body></html>`;

async function avvia({ xFinestra = 80 } = {}) {
  const userData = cartellaTemporanea('filo-barra-g3-');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.url.startsWith('/due') ? SITO.replace('Una pagina qualunque', 'Pagina due') : SITO);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/sito`;
  const env = { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_VISIBLE: '1' };
  delete env.FILO_HIDE_WINDOW;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  const page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 }).catch(() => {});
  await expect.poll(async () => (await statoBarra(app))?.bounds?.width ?? 0, { timeout: 10_000 }).toBe(4);
  await app.evaluate(({ BrowserWindow }, x) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x, y: 40, width: 1100, height: 800 }), xFinestra);
  await pausa(900);
  const info = async () => app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return { cb: w.getContentBounds(), scala: screen.getPrimaryDisplay().scaleFactor, max: w.isMaximized(), tb: t.view.getBounds(), bb: w._filoTabs.barra.vista.getBounds() };
  });
  const i = await info();
  const px = (v) => Math.round(v * i.scala);
  const chiudi = async () => {
    await chiudiApp(app);
    try { server.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  };
  return { app, shell, page, url, info, ...i, x0: px(i.cb.x), y: px(i.cb.y + 320), px, chiudi };
}

const aperta = async (app) => (await statoBarra(app)).aperta;

test.skip('spinta spenta: il clic vero sulla striscia apre la barra', async () => {
  test.skip(!xtestDisponibile(), 'XTest');
  test.setTimeout(90_000);
  const f = await avvia();
  try {
    const { app, x0, y, px } = f;
    await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { barraLaterale: { spinta: false } } }, { url: 'filo://preferences/preferences.html' }));
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.barra.opzioni.spinta)).toBe(false);
    const s = await statoBarra(app);
    console.log('striscia bounds', JSON.stringify(s.bounds), 'max', f.max);
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + 1}:${y};wait:150;down;wait:60;up;wait:700`);
    console.log('clic x0+1, aperta:', await aperta(app));
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + 3}:${y};wait:150;down;wait:60;up;wait:700`);
    console.log('clic x0+3, aperta:', await aperta(app));
    expect(await aperta(app), 'clic sulla striscia con la spinta spenta').toBe(true);
  } finally {
    await f.chiudi();
  }
});

test.skip('tasto destro vero sulla striscia: il suo menu', async () => {
  test.skip(!xtestDisponibile(), 'XTest');
  test.setTimeout(90_000);
  const f = await avvia();
  try {
    const { app, x0, y, px } = f;
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + 2}:${y};wait:60;rdown;wait:60;rup;wait:800`);
    const menu = await menuAperto(app, { tetto: 2000 });
    console.log('menu striscia:', menu ? await vociDelMenu(menu) : null, 'aperta:', await aperta(app));
    expect(menu, 'menu della striscia col tasto destro vero').toBeTruthy();
  } finally {
    await f.chiudi();
  }
});

test.skip('puntatore vero: dal menu del tasto destro alla barra, e dalla barra al menu', async () => {
  test.skip(!xtestDisponibile(), 'XTest');
  test.setTimeout(120_000);
  const f = await avvia();
  try {
    const { app, page, px } = f;
    const barra = await barraPage(app);
    let i = await f.info();
    const dallaPagina = (x, y) => ({ X: px(i.cb.x + i.tb.x + x), Y: px(i.cb.y + i.tb.y + y) });
    const pb = await page.locator('#p').boundingBox();
    const r = dallaPagina(pb.x + 200, pb.y + pb.height / 2);
    puntatore(`move:${r.X}:${r.Y};wait:100;rdown;wait:40;rup;wait:600`);
    const icona = page.locator('.sn-menu [data-sn-icon-id="screenshot"]').first();
    await expect(icona).toBeVisible();
    const ib = await icona.boundingBox();
    const a = dallaPagina(ib.x + ib.width / 2, ib.y + ib.height / 2);
    puntatore(`move:${a.X}:${a.Y};wait:120;down;wait:60;move:${a.X + 8}:${a.Y + 8};wait:40;move:${a.X + 20}:${a.Y + 15};wait:200`);
    await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(true);
    await pausa(400);
    i = await f.info();
    const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
    const hX = px(i.cb.x + i.bb.x + 28);
    const hY = px(i.cb.y + i.bb.y + home.y + 4);
    puntatore(`move:${a.X - 100}:${hY};wait:40;move:${hX + 10}:${hY};wait:40;move:${hX}:${hY};wait:300`);
    console.log('mira', JSON.stringify((await statoBarra(app))));
    puntatore('up;wait:800');
    const dopo = await statoBarra(app);
    console.log('bar dopo', dopo.bar);
    expect(dopo.bar, 'screenshot posato nella barra col puntatore vero').toContain('screenshot');
    await page.screenshot({ path: 'tests/.shots/g3-dopo-posa-pagina.png' }).catch(() => {});

    // Ritorno: menu aperto, barra aperta, trascino l'icona dalla barra alla riga del menu.
    puntatore(`move:${px(i.cb.x + i.tb.x + 600)}:${px(i.cb.y + i.tb.y + 500)};wait:900`);
    await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(false);
    puntatore(`move:${r.X}:${r.Y};wait:100;rdown;wait:40;rup;wait:600`);
    const riga = page.locator('.sn-menu .sn-menu-row[data-sn-drop-target="primary"]').first();
    await expect(riga).toBeVisible();
    // La apro spingendo sul bordo col menu aperto.
    puntatore(`move:${f.x0 + px(200)}:${f.y};wait:100;move:${f.x0 + 1}:${f.y};wait:40;move:${f.x0 + 1}:${f.y + 2};wait:700`);
    await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(true);
    console.log('menu ancora aperto dopo la spinta?', await riga.isVisible());
    i = await f.info();
    const sb = await barra.locator('#nav .ico[data-id="screenshot"]').boundingBox();
    const s = { X: px(i.cb.x + i.bb.x + sb.x + sb.width / 2), Y: px(i.cb.y + i.bb.y + sb.y + sb.height / 2) };
    const rb = await riga.boundingBox();
    const d = dallaPagina(rb.x + rb.width - 20, rb.y + rb.height / 2);
    puntatore(`move:${s.X}:${s.Y};wait:200;down;wait:60;move:${s.X + 8}:${s.Y + 4};wait:40;move:${s.X + 60}:${s.Y + 10};wait:40;move:${d.X - 30}:${d.Y};wait:40;move:${d.X}:${d.Y};wait:300`);
    console.log('anteprima nel menu:', await page.locator('.sn-drag-preview').count());
    puntatore('up;wait:800');
    const fine = await statoBarra(app);
    console.log('bar fine', fine.bar, 'primary', fine.primary);
    expect(fine.bar, 'screenshot tolto dalla barra col puntatore vero').not.toContain('screenshot');
  } finally {
    await f.chiudi();
  }
});

test.skip('puntatore vero: aperta dal bordo, clic su Indietro e su Home', async () => {
  test.skip(!xtestDisponibile(), 'XTest');
  test.setTimeout(90_000);
  const f = await avvia();
  try {
    const { app, page, px } = f;
    const barra = await barraPage(app);
    await page.locator('#vai').click();
    await expect.poll(() => page.url()).toContain('/due');
    puntatore(`move:${f.x0 + px(300)}:${f.y};wait:100;move:${f.x0 + 1}:${f.y};wait:40;move:${f.x0 + 1}:${f.y + 2};wait:700`);
    await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(true);
    await pausa(300);
    const i = await f.info();
    const b = await barra.locator('#nav .ico[data-id="back"]').boundingBox();
    const X = px(i.cb.x + i.bb.x + b.x + b.width / 2);
    const Y = px(i.cb.y + i.bb.y + b.y + b.height / 2);
    puntatore(`move:${f.x0 + 10}:${Y};wait:60;move:${X}:${Y};wait:200;down;wait:50;up;wait:800`);
    await expect.poll(() => page.url(), { timeout: 3000 }).toContain('/sito');
    console.log('dopo Indietro aperta:', await aperta(app));
  } finally {
    await f.chiudi();
  }
});

test('puntatore vero: App, Impostazioni e Profilo dalla barra aperta dal bordo', async () => {
  test.skip(!xtestDisponibile(), 'XTest');
  test.setTimeout(120_000);
  const f = await avvia({ xFinestra: 0 });
  try {
    const { app, px } = f;
    const barra = await barraPage(app);
    for (const comando of ['apps', 'settings', 'account', 'history']) {
      puntatore(`move:${f.x0 + px(500)}:${f.y};wait:600`);
      await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(false);
      puntatore(`move:${f.x0 + px(300)}:${f.y};wait:100;move:${f.x0 + 1}:${f.y};wait:40;move:${f.x0 + 1}:${f.y + 2};wait:700`);
      await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(true);
      await pausa(300);
      const i = await f.info();
      const b = await barra.locator(`#fisse .ico[data-comando="${comando}"]`).boundingBox();
      const X = px(i.cb.x + i.bb.x + b.x + b.width / 2);
      const Y = px(i.cb.y + i.bb.y + b.y + b.height / 2);
      puntatore(`move:${f.x0 + 10}:${Y};wait:60;move:${X}:${Y};wait:600`);
      if (process.env.G3_SCROT) try { execFileSync('scrot', ['-o', `tests/.shots/g3-hover-${comando}.png`], { cwd: APP_ROOT, env: process.env }); } catch (_) {}
      puntatore('down;wait:50;up');
      const tr = [];
      for (let k = 0; k < 30; k++) {
        tr.push(await app.evaluate(({ BrowserWindow }) => {
          const main = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
          const pop = BrowserWindow.getAllWindows().find((x) => x !== main && !x._filoTabs && x.getBounds().height > 100);
          const foc = BrowserWindow.getFocusedWindow();
          return `${pop ? (pop.isVisible() ? 'V' : 'h') : '-'}${foc === main ? 'M' : foc ? 'P' : '0'}`;
        }));
        await pausa(40);
      }
      console.log(comando, 'traccia:', tr.join(' '));
      try { execFileSync('scrot', ['-o', `tests/.shots/g3-clic-${comando}.png`], { cwd: APP_ROOT, env: process.env }); } catch (_) {}
      const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ u: w.webContents.getURL().slice(0, 30), v: w.isVisible(), b: w.getBounds() })));
      console.log(comando, 'aperta:', await aperta(app), 'finestre:', JSON.stringify(wins));
      puntatore('wait:1200');
      try { execFileSync('scrot', ['-o', `tests/.shots/g3-dopo-${comando}.png`], { cwd: APP_ROOT, env: process.env }); } catch (_) {}
      console.log(comando, 'dopo 1.2s aperta:', await aperta(app));
      await f.shell.keyboard.press('Escape').catch(() => {});
    }
  } finally {
    await f.chiudi();
  }
});

test('puntatore vero: il menu App dalla barra, visibile nel tempo', async () => {
  test.skip(!xtestDisponibile(), 'XTest');
  test.setTimeout(120_000);
  const f = await avvia({ xFinestra: 0 });
  try {
    const { app, px } = f;
    const barra = await barraPage(app);
    const traccia = async (ms) => {
      const out = [];
      const fine = Date.now() + ms;
      while (Date.now() < fine) {
        out.push(await app.evaluate(({ BrowserWindow }) => {
          const main = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
          const pop = BrowserWindow.getAllWindows().find((x) => x !== main && !x._filoTabs && x.getBounds().height > 100);
          const foc = BrowserWindow.getFocusedWindow();
          return `${pop ? (pop.isVisible() ? 'V' : 'h') : '-'}${foc === main ? 'M' : foc ? 'P' : '0'}`;
        }));
        await pausa(40);
      }
      return out.join(' ');
    };
    // 1) clic di Playwright
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    await barra.locator('#fisse [data-comando="apps"]').click();
    console.log('playwright:', await traccia(1200));
    await f.shell.keyboard.press('Escape').catch(() => {});
    puntatore(`move:${f.x0 + px(500)}:${f.y};wait:900`);
    // 2) clic vero, barra aperta dal bordo
    puntatore(`move:${f.x0 + px(300)}:${f.y};wait:100;move:${f.x0 + 1}:${f.y};wait:40;move:${f.x0 + 1}:${f.y + 2};wait:700`);
    await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(true);
    await pausa(300);
    let i = await f.info();
    let b = await barra.locator('#fisse .ico[data-comando="apps"]').boundingBox();
    let X = px(i.cb.x + i.bb.x + b.x + b.width / 2);
    let Y = px(i.cb.y + i.bb.y + b.y + b.height / 2);
    puntatore(`move:${f.x0 + 10}:${Y};wait:60;move:${X}:${Y};wait:200;down;wait:50;up`);
    console.log('vero, dal bordo:', await traccia(1200));
    puntatore(`move:${f.x0 + px(500)}:${f.y};wait:900`);
    for (const attesa of [600, 1000]) {
      puntatore(`move:${f.x0 + px(300)}:${f.y};wait:100;move:${f.x0 + 1}:${f.y};wait:40;move:${f.x0 + 1}:${f.y + 2};wait:700`);
      await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(true);
      await pausa(300);
      puntatore(`move:${f.x0 + 10}:${Y};wait:60;move:${X}:${Y};wait:${attesa};down;wait:50;up`);
      console.log(`vero, dal bordo, fermo ${attesa} ms sopra:`, await traccia(1500));
      try { execFileSync('scrot', ['-o', `tests/.shots/g3-app-dopo-sosta-${attesa}.png`], { cwd: APP_ROOT, env: process.env }); } catch (_) {}
      puntatore(`move:${f.x0 + px(500)}:${f.y};wait:900`);
      await f.shell.keyboard.press('Escape').catch(() => {});
    }
    puntatore(`move:${f.x0 + px(500)}:${f.y};wait:900`);
    // 3) clic vero, barra aperta col comando (clic)
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    i = await f.info();
    puntatore(`move:${f.x0 + 30}:${Y - 100};wait:100;move:${X}:${Y};wait:200;down;wait:50;up`);
    console.log('vero, aperta col clic:', await traccia(1200));
    // 4) la maniglia della shell e il menu del profilo dalla shell (se c'è) per confronto
    const shellApps = await f.shell.evaluate(() => { const b = document.querySelector('[data-command="apps"], #btn-apps, #apps-btn'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, vis: r.width > 0 }; });
    console.log('bottone App nella shell:', JSON.stringify(shellApps));
  } finally {
    await f.chiudi();
  }
});

test('schermo intero e finestra massimizzata: striscia, clic e aspetto', async () => {
  test.skip(!xtestDisponibile(), 'XTest');
  test.setTimeout(120_000);
  const f = await avvia({ xFinestra: 0 });
  try {
    const { app, px } = f;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
    await pausa(1200);
    const s = await statoBarra(app);
    console.log('schermo intero:', JSON.stringify({ b: s.bounds, fs: s.schermoIntero }), JSON.stringify(await f.info()));
    try { execFileSync('scrot', ['-o', 'tests/.shots/g3-schermo-intero.png'], { cwd: APP_ROOT, env: process.env }); } catch (_) {}
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(false));
    await pausa(800);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).maximize());
    await pausa(1200);
    const i = await f.info();
    console.log('massimizzata:', i.max, JSON.stringify(i.cb));
    await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { barraLaterale: { spinta: false } } }, { url: 'filo://preferences/preferences.html' }));
    await pausa(300);
    const y = px(i.cb.y + 320);
    puntatore(`move:${px(i.cb.x + 400)}:${y};wait:150;move:${px(i.cb.x) + 1}:${y};wait:150;down;wait:60;up;wait:700`);
    console.log('massimizzata, spinta spenta, clic striscia -> aperta:', await aperta(app));
  } finally {
    await f.chiudi();
  }
});

test('puntatore vero: dalla fila delle schede giù lungo il bordo, e da sotto la finestra', async () => {
  test.skip(!xtestDisponibile(), 'XTest');
  test.setTimeout(120_000);
  const f = await avvia();
  try {
    const { app, px, cb } = f;
    const yTab = px(cb.y + 20);
    const yPag = px(cb.y + 320);
    // Dalla fila delle schede, dentro, poi al bordo e giù lungo il bordo.
    puntatore(`move:${f.x0 + px(200)}:${yTab};wait:200;move:${f.x0 + 2}:${yTab};wait:40;move:${f.x0 + 2}:${yTab + 60};wait:30;move:${f.x0 + 2}:${yTab + 160};wait:30;move:${f.x0 + 2}:${yPag};wait:900`);
    console.log('dalla fila delle schede giù lungo il bordo:', await aperta(app));
    puntatore(`move:${f.x0 + px(500)}:${yPag};wait:900`);
    // Da sotto la finestra, fuori, su lungo il bordo.
    const ySotto = px(cb.y + cb.height + 30);
    puntatore(`move:${f.x0 + px(500)}:${yPag};wait:300;move:${f.x0 + px(300)}:${ySotto};wait:300;move:${f.x0 + 2}:${ySotto};wait:100;move:${f.x0 + 2}:${ySotto - 60};wait:30;move:${f.x0 + 2}:${yPag};wait:900`);
    console.log('da sotto la finestra su lungo il bordo:', await aperta(app));
    puntatore(`move:${f.x0 + px(500)}:${yPag};wait:900`);
    // Dalla fila delle schede dritto in diagonale al bordo della pagina.
    puntatore(`move:${f.x0 + px(300)}:${yTab};wait:200;move:${f.x0 + 1}:${yPag};wait:900`);
    console.log('dalla fila in diagonale:', await aperta(app));
    puntatore(`move:${f.x0 + px(500)}:${yPag};wait:900`);
    // Dalla maniglia (in cima a sinistra) giù.
    puntatore(`move:${f.x0 + 6}:${px(cb.y + 18)};wait:300;move:${f.x0 + 2}:${px(cb.y + 60)};wait:30;move:${f.x0 + 2}:${yPag};wait:900`);
    console.log('dalla maniglia giù:', await aperta(app));
  } finally {
    await f.chiudi();
  }
});

test('puntatore vero: i suggerimenti al passaggio sulle icone', async () => {
  test.skip(!xtestDisponibile(), 'XTest');
  test.setTimeout(120_000);
  const f = await avvia({ xFinestra: 0 });
  try {
    const { app, px } = f;
    const barra = await barraPage(app);
    puntatore(`move:${f.x0 + px(300)}:${f.y};wait:100;move:${f.x0 + 1}:${f.y};wait:40;move:${f.x0 + 1}:${f.y + 2};wait:700`);
    await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(true);
    await pausa(300);
    const i = await f.info();
    for (const sel of ['#nav .ico[data-id="reload"]', '#nav .ico[data-id="reload"]', '#nav .ico[data-id="home"]', '#fisse .ico[data-comando="apps"]', '#fisse .ico[data-comando="history"]', '#ora']) {
      const b = await barra.locator(sel).boundingBox();
      const X = px(i.cb.x + i.bb.x + b.x + b.width / 2);
      const Y = px(i.cb.y + i.bb.y + b.y + b.height / 2);
      puntatore(`move:${X}:${Y};wait:${process.env.G3_ATTESA || 700}`);
      const w = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => !x._filoTabs).map((x) => ({ v: x.isVisible(), b: x.getBounds() })));
      const t = await app.evaluate(async ({ BrowserWindow }) => {
        const x = BrowserWindow.getAllWindows().find((y) => !y._filoTabs && y.isVisible() && y.getBounds().height < 60);
        return x ? x.webContents.executeJavaScript('document.body.innerText') : null;
      }).catch(() => null);
      console.log(sel, '->', JSON.stringify(t), JSON.stringify(w), 'aperta', await aperta(app));
    }
  } finally {
    await f.chiudi();
  }
});

test('puntatore vero: il primo suggerimento dopo l\'apertura, per strade diverse', async () => {
  test.skip(!xtestDisponibile(), 'XTest');
  test.setTimeout(120_000);
  const f = await avvia({ xFinestra: 0 });
  try {
    const { app, px } = f;
    const barra = await barraPage(app);
    const sugg = async () => app.evaluate(async ({ BrowserWindow }) => {
      const x = BrowserWindow.getAllWindows().find((y) => !y._filoTabs && y.isVisible() && y.getBounds().height < 60);
      return x ? x.webContents.executeJavaScript('document.body.innerText') : null;
    }).catch(() => null);
    const dove = async (sel) => {
      const i = await f.info();
      const b = await barra.locator(sel).boundingBox();
      return { X: px(i.cb.x + i.bb.x + b.x + b.width / 2), Y: px(i.cb.y + i.bb.y + b.y + b.height / 2) };
    };
    // a) dal bordo, a passi
    puntatore(`move:${f.x0 + px(300)}:${f.y};wait:100;move:${f.x0 + 1}:${f.y};wait:40;move:${f.x0 + 1}:${f.y + 2};wait:700`);
    await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(true);
    await pausa(300);
    let d = await dove('#nav .ico[data-id="home"]');
    puntatore(`move:${f.x0 + 6}:${d.Y};wait:30;move:${f.x0 + 12}:${d.Y};wait:30;move:${d.X - 4}:${d.Y};wait:30;move:${d.X}:${d.Y};wait:900`);
    console.log('a) dal bordo a passi ->', await sugg());
    puntatore(`move:${f.x0 + px(500)}:${f.y};wait:900`);
    // b) aperta dalla scorciatoia col puntatore sulla pagina, poi sull'icona
    await comandaBarra(app, 'tasto');
    await pannelloFermo(barra);
    d = await dove('#nav .ico[data-id="home"]');
    puntatore(`move:${f.x0 + px(200)}:${d.Y};wait:100;move:${d.X + 20}:${d.Y};wait:30;move:${d.X}:${d.Y};wait:900`);
    console.log('b) dalla scorciatoia ->', await sugg());
    await comandaBarra(app, 'chiudi');
    puntatore(`move:${f.x0 + px(500)}:${f.y};wait:900`);
    // c) dal bordo, salto diretto (come prima)
    puntatore(`move:${f.x0 + px(300)}:${f.y};wait:100;move:${f.x0 + 1}:${f.y};wait:40;move:${f.x0 + 1}:${f.y + 2};wait:700`);
    await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(true);
    await pausa(300);
    d = await dove('#nav .ico[data-id="home"]');
    puntatore(`move:${d.X}:${d.Y};wait:900`);
    console.log('c) dal bordo salto diretto ->', await sugg());
    puntatore(`move:${d.X}:${d.Y + 1};wait:900`);
    console.log('c) dopo un pixel ->', await sugg());
  } finally {
    await f.chiudi();
  }
});

test('puntatore vero: il primo suggerimento della sessione nella fila delle schede', async () => {
  test.skip(!xtestDisponibile(), 'XTest');
  test.setTimeout(120_000);
  const f = await avvia({ xFinestra: 0 });
  try {
    const { app, px, cb } = f;
    const sugg = async () => app.evaluate(async ({ BrowserWindow }) => {
      const x = BrowserWindow.getAllWindows().find((y) => !y._filoTabs && y.isVisible() && y.getBounds().height < 60);
      return x ? x.webContents.executeJavaScript('document.body.innerText') : null;
    }).catch(() => null);
    const tipi = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => !x._filoTabs).map((x) => x.getBounds()));
    console.log('finestre prima di ogni passaggio:', JSON.stringify(tipi));
    const btn = await f.shell.evaluate(() => [...document.querySelectorAll('[data-tip]')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.className, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    console.log('bottoni con suggerimento:', JSON.stringify(btn.slice(0, 6)));
    const b = btn.find((x) => x.id !== 'barra-maniglia') || btn[0];
    puntatore(`move:${px(cb.x + b.x - 30)}:${px(cb.y + b.y)};wait:100;move:${px(cb.x + b.x)}:${px(cb.y + b.y)};wait:1500`);
    console.log('primo nella fila ->', b.id, await sugg());
    puntatore(`move:${px(cb.x + 600)}:${px(cb.y + 400)};wait:600;move:${px(cb.x + b.x - 3)}:${px(cb.y + b.y)};wait:100;move:${px(cb.x + b.x)}:${px(cb.y + b.y)};wait:1500`);
    console.log('secondo nella fila ->', b.id, await sugg());
  } finally {
    await f.chiudi();
  }
});
