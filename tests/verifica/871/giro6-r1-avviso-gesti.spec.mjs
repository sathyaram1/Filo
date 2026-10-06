// #871 giro 6, rilievo 1 — sopra l'avviso del sito pericoloso la barra deve sentire i gesti fatti sull'avviso
// come quelli fatti sulla pagina: fermo sul bordo si apre, un clic sull'avviso la chiude, uscendo si chiude.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

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
  if (!['/usr/lib/x86_64-linux-gnu/libXtst.so.6', '/usr/lib/aarch64-linux-gnu/libXtst.so.6', '/usr/lib/libXtst.so.6'].some((f) => existsSync(f))) return false;
  try { execFileSync('python3', ['-c', 'import ctypes'], { stdio: 'ignore' }); return true; } catch (_) { return false; }
};

const SEGNALATA = '<title>Accedi</title><body style="margin:0;height:3000px"><button style="position:fixed;inset:0;width:100%">Accedi</button>'
  + '<script>window.__g={giu:0};document.addEventListener("mousedown",function(){__g.giu++},true);</script></body>';

// Filo visibile e non massimizzato, come si apre; un sito buono e poi, nella stessa scheda, uno segnalato.
async function avvia() {
  const userData = cartellaTemporanea('filo-871-giro6-');
  const env = { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_VISIBLE: '1' };
  delete env.FILO_HIDE_WINDOW;
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  await app.evaluate(async ({ session, net }, html) => {
    const risposta = (req) => {
      const h = new URL(req.url).hostname;
      if (h === 'conto-paypa1.com') return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (h === 'buono.example') return new Response('<title>Buono</title><body>buono</body>', { headers: { 'content-type': 'text/html' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: async (u) => ({ listed: /paypa1/.test(String(u && (u.url || u))), category: 'phishing' }), rdap: null, ct: null, sandbox: null, llm: async () => ({ suspicious: false }) });
  }, SEGNALATA);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x: 80, y: 40, width: 1100, height: 800 }));
  await pausa(600);
  const trova = (f) => app.windows().find((w) => { try { return f(w.url()); } catch (_) { return false; } });
  await shell.evaluate(() => window.filoShell.tabs.open('https://buono.example/'));
  await expect.poll(() => !!trova((u) => u === 'https://buono.example/'), { timeout: 10_000 }).toBe(true);
  await pausa(600);
  await trova((u) => u === 'https://buono.example/').evaluate(() => { location.href = 'https://conto-paypa1.com/login'; });
  await expect.poll(() => coperta(app), { timeout: 10_000 }).toBe(true);
  let page = null;
  await expect.poll(() => { page = trova((u) => new URL(u).hostname === 'conto-paypa1.com'); return !!page; }).toBe(true);
  await page.waitForFunction(() => !!window.__g);
  await expect.poll(() => !!trova((u) => u.startsWith('filo://shell/avviso-sito.html'))).toBe(true);
  const barra = await barraPage(app);
  await pausa(600);
  const chiudi = async () => { await chiudiApp(app); try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} };
  return { app, page, barra, chiudi };
}
const coperta = (app) => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisoSito.coperta());
const aperta = async (app) => (await statoBarra(app)).aperta;
const sullAvviso = (app, eventi) => app.evaluate(({ BrowserWindow }, ev) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  for (const e of ev) tm.avvisoSito.webContents().sendInputEvent(e);
}, eventi);

test('r1 sopra l\'avviso del sito pericoloso, fermo sul bordo sinistro col puntatore vero la barra si apre, e il clic sulla striscia pure', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(120_000);
  const { app, page, chiudi } = await avvia();
  try {
    const { cb, scala } = await app.evaluate(({ BrowserWindow, screen }) => ({ cb: BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).getContentBounds(), scala: screen.getPrimaryDisplay().scaleFactor }));
    const px = (v) => Math.round(v * scala);
    const x0 = px(cb.x);
    const y = px(cb.y + 320);
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + 2}:${y};wait:40;move:${x0 + 1}:${y + 2};wait:1200`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
    await comandaBarra(app, 'chiudi');
    puntatore(`move:${x0 + px(400)}:${y};wait:900;move:${x0 + 1}:${y + 60};wait:60;down;wait:40;up;wait:600`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
    expect(await coperta(app)).toBe(true);
    expect(await page.evaluate(() => window.__g.giu)).toBe(0);
  } finally {
    await chiudi();
  }
});

test('r1 sopra l\'avviso del sito pericoloso un clic sull\'avviso chiude la barra, e uscendo dalla barra sull\'avviso si chiude', async () => {
  test.setTimeout(120_000);
  const { app, barra, chiudi } = await avvia();
  try {
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    await sullAvviso(app, [
      { type: 'mouseMove', x: 700, y: 500 },
      { type: 'mouseDown', x: 700, y: 500, button: 'left', clickCount: 1 },
      { type: 'mouseUp', x: 700, y: 500, button: 'left', clickCount: 1 },
    ]);
    await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(false);

    await comandaBarra(app, 'spinta');
    await pannelloFermo(barra);
    for (let i = 0; i < 10; i++) { await sullAvviso(app, [{ type: 'mouseMove', x: 600 + i * 10, y: 400 }]); await pausa(150); }
    await expect.poll(() => aperta(app), { timeout: 4000 }).toBe(false);
    expect(await coperta(app)).toBe(true);
  } finally {
    await chiudi();
  }
});
