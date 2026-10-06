// #871 — la barra laterale col puntatore VERO (XTest sullo schermo virtuale), a finestra non massimizzata come
// Filo si apre: i primi pixel del bordo li prende il sistema per ridimensionare, e lì la barra si apre lo stesso.
// Il mouse di Playwright entra dritto in una vista e salta questa scelta: qui no. Senza XTest si salta.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { barraPage, statoBarra, premi, comandaBarra, menuAperto, vociDelMenu, scegliNelMenu } from './helpers/barra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
  <h1>Una pagina qualunque</h1><p>Testo.</p></body></html>`;

// Filo a schermo (la finestra si vede: il puntatore vero ci deve arrivare), su un sito.
async function avvia({ xFinestra = 80 } = {}) {
  const userData = cartellaTemporanea('filo-barra-bordo-');
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
  await expect.poll(async () => (await statoBarra(app))?.bounds?.width ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
  // Staccata dal bordo dello schermo, così il puntatore può anche uscirne a sinistra.
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
  return { app, shell, max, cb, x0: px(cb.x), y: px(cb.y + 320), px, chiudi };
}

const aperta = async (app) => (await statoBarra(app)).aperta;

test('fermo sul bordo sinistro la barra si apre anche dove il sistema ridimensiona; di corsa o accanto no', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  const { app, max, x0, y, px, chiudi } = await avvia();
  try {
    expect(max, 'Filo si apre non massimizzato: è il caso da provare').toBe(false);
    const barra = await barraPage(app);

    // Di corsa: arriva sul bordo e torna via prima dell'attesa.
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + 1}:${y};wait:80;move:${x0 + px(400)}:${y};wait:700`);
    expect(await aperta(app)).toBe(false);

    // Accanto al bordo, sulla pagina: niente.
    puntatore(`move:${x0 + px(14)}:${y};wait:40;move:${x0 + px(12)}:${y + 3};wait:800`);
    expect(await aperta(app)).toBe(false);

    // Fermo contro il bordo: la striscia si accende mentre aspetta, poi la barra si apre.
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + 2}:${y};wait:40;move:${x0 + 1}:${y + 2};wait:120`);
    await expect(barra.locator('#striscia.bordo')).toHaveCount(1);
    puntatore('wait:500');
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
    expect((await statoBarra(app)).motivo).toBe('spinta');

    // Il puntatore esce dalla finestra a sinistra senza passare dal pannello: la barra si chiude.
    puntatore(`move:${x0 - px(40)}:${y};wait:1200`);
    await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(false);

    // Il clic sulla striscia (che sta nella stessa fascia) la apre.
    puntatore(`move:${x0 + px(400)}:${y};wait:900;move:${x0 + 1}:${y + 60};wait:60;down;wait:40;up;wait:500`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
  } finally {
    await chiudi();
  }
});

test('con l\'apertura dal bordo spenta, fermo sul bordo non si apre; la maniglia sì', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  const { app, x0, y, px, chiudi } = await avvia();
  try {
    await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { barraLaterale: { spinta: false } } }, { url: 'filo://preferences/preferences.html' }));
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.barra.opzioni.spinta)).toBe(false);
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + 1}:${y};wait:40;move:${x0}:${y + 2};wait:900`);
    expect(await aperta(app)).toBe(false);
    const shell = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/shell.html'); } catch (_) { return false; } });
    const m = await shell.locator('#barra-maniglia').boundingBox();
    const yFinestra = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).getContentBounds().y);
    puntatore(`move:${x0 + px(m.x + m.width / 2)}:${px(yFinestra + m.y + m.height / 2)};wait:100;down;wait:40;up;wait:500`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
  } finally {
    await chiudi();
  }
});

test('un lancio contro il bordo, o il ritorno da fuori della finestra, e poi fermo: la barra si apre', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  // Finestra accostata al bordo dello schermo: il lancio, pochi movimenti veloci e l'ultimo nella pagina lontano dal bordo.
  let f = await avvia({ xFinestra: 0 });
  try {
    const { app, x0, y, px } = f;
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + px(250)}:${y};wait:8;move:${x0 + px(120)}:${y};wait:8;move:${x0 + px(40)}:${y};wait:8;move:${x0}:${y};wait:900`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
  } finally {
    await f.chiudi();
  }
  // Finestra in mezzo allo schermo: il puntatore sfora a sinistra, torna e si ferma sul bordo.
  f = await avvia();
  try {
    const { app, x0, y, px } = f;
    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + px(60)}:${y};wait:16;move:${x0 - 50}:${y};wait:300;move:${x0 - 20}:${y};wait:30;move:${x0 - 8}:${y};wait:30;move:${x0 + 2}:${y};wait:1000`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
  } finally {
    await f.chiudi();
  }
});

test('una scheda trascinata o una selezione portate sul bordo non la aprono, nemmeno lasciate lì; chiusa col tasto, ferma sul bordo resta chiusa', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  const { app, shell, cb, x0, y, px, chiudi } = await avvia();
  try {
    // La scheda attiva trascinata giù dalla fila fino al bordo sinistro, e tenuta lì.
    const t = await shell.evaluate(() => { const r = document.querySelector('.tab.active').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const tx = px(cb.x + t.x);
    const ty = px(cb.y + t.y);
    puntatore(`move:${tx}:${ty};wait:100;down;wait:80;move:${tx - 10}:${ty + 5};wait:30;move:${tx - 40}:${ty + 60};wait:30;move:${x0 + 60}:${y};wait:30;move:${x0 + 2}:${y};wait:30;move:${x0}:${y + 6};wait:900`);
    expect(await aperta(app), 'scheda tenuta sul bordo').toBe(false);
    puntatore('up;wait:900');
    expect(await aperta(app), 'scheda lasciata sul bordo').toBe(false);
    puntatore(`move:${x0 + px(500)}:${y};wait:500`);

    // Una selezione di testo trascinata fino al bordo, poi lasciata lì.
    const ys = px(cb.y + (await statoBarra(app)).alto + 60);
    puntatore(`move:${x0 + px(400)}:${ys};wait:100;down;wait:60;move:${x0 + px(200)}:${ys};wait:30;move:${x0 + 2}:${ys + 4};wait:30;move:${x0}:${ys + 8};wait:900`);
    expect(await aperta(app), 'selezione tenuta sul bordo').toBe(false);
    puntatore('up;wait:900');
    expect(await aperta(app), 'selezione lasciata sul bordo').toBe(false);
    // Ma basta muoversi lungo il bordo per spingere di nuovo.
    puntatore(`move:${x0 + 1}:${ys + 30};wait:900`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);

    // Chiusa con la scorciatoia col puntatore fermo sul bordo: resta chiusa.
    await premi(app, 'scheda', 'B', ['control', 'shift']);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(false);
    await pausa(900);
    expect(await aperta(app), 'chiusa col tasto, puntatore fermo sul bordo').toBe(false);
  } finally {
    await chiudi();
  }
});

test('la striscia si tocca oltre la fascia del sistema: il clic la apre anche a spinta spenta, il tasto destro dà il suo menu, fermarsi lì non la apre', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  const { app, max, x0, y, px, chiudi } = await avvia();
  try {
    expect(max, 'Filo si apre non massimizzato: è il caso da provare').toBe(false);
    const s = await statoBarra(app);
    expect(s.bounds.width, 'la striscia chiusa va oltre i 5 px del sistema').toBe(9);
    const oltre = x0 + 7;

    // Fermo sulla parte che si clicca, a due passi dal bordo: è già pagina, non si apre da sola.
    puntatore(`move:${x0 + px(300)}:${y};wait:150;move:${oltre}:${y};wait:40;move:${oltre}:${y + 2};wait:900`);
    expect(await aperta(app), 'fermo oltre la fascia').toBe(false);

    // Il tasto destro apre il menu della striscia.
    puntatore(`move:${oltre}:${y + 30};wait:60;rdown;wait:40;rup;wait:500`);
    const menu = await menuAperto(app, { tetto: 3000 });
    expect(menu, 'il menu della striscia non si è aperto').toBeTruthy();
    expect(await vociDelMenu(menu)).toContain('Apri la barra laterale');
    await scegliNelMenu(menu, 'Apri la barra laterale');
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
    await comandaBarra(app, 'chiudi');
    puntatore(`move:${x0 + px(400)}:${y};wait:400`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(false);

    // Con l'apertura dal bordo spenta il clic la apre lo stesso.
    await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { barraLaterale: { spinta: false } } }, { url: 'filo://preferences/preferences.html' }));
    await expect.poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.barra.opzioni.spinta)).toBe(false);
    puntatore(`move:${oltre}:${y};wait:100;down;wait:50;up;wait:600`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
  } finally {
    await chiudi();
  }
});

// La barra sente il puntatore su quello che l'utente vede: sopra l'avviso del sito pericoloso è l'avviso, e
// chi lo guarda cerca proprio Indietro (giro 6 di #871).
test('sopra l\'avviso del sito pericoloso, fermo sul bordo la barra si apre, e il clic sulla striscia pure', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  const { app, x0, y, px, chiudi } = await avvia();
  try {
    await app.evaluate(async ({ session, net }) => {
      const pagina = '<title>Accedi</title><body style="margin:0"><button style="position:fixed;inset:0;width:100%">Accedi</button></body>';
      const risposta = (req) => (new URL(req.url).hostname === 'conto-paypa1.com'
        ? new Response(pagina, { headers: { 'content-type': 'text/html; charset=utf-8' } })
        : net.fetch(req, { bypassCustomProtocolHandlers: true }));
      for (const s of ['http', 'https']) {
        try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
        session.defaultSession.protocol.handle(s, risposta);
      }
      globalThis.SN_SAFEBROWSE.setProviders({ gsb: async (u) => ({ listed: /paypa1/.test(String(u && (u.url || u))), category: 'phishing' }), rdap: null, ct: null, sandbox: null, llm: async () => ({ suspicious: false }) });
    });
    const sito = app.windows().find((w) => { try { return w.url().endsWith('/sito'); } catch (_) { return false; } });
    await sito.evaluate(() => { location.href = 'https://conto-paypa1.com/login'; });
    const coperta = () => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.avvisoSito.coperta());
    await expect.poll(coperta, { timeout: 10_000 }).toBe(true);
    await pausa(600);

    puntatore(`move:${x0 + px(400)}:${y};wait:150;move:${x0 + 2}:${y};wait:40;move:${x0 + 1}:${y + 2};wait:1200`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
    await comandaBarra(app, 'chiudi');
    puntatore(`move:${x0 + px(400)}:${y};wait:900;move:${x0 + 1}:${y + 60};wait:60;down;wait:40;up;wait:600`);
    await expect.poll(() => aperta(app), { timeout: 2000 }).toBe(true);
    expect(await coperta()).toBe(true);
  } finally {
    await chiudi();
  }
});
