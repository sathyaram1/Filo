// #1433 — il pannello degli strumenti dell'Editor col puntatore VERO (XTest sullo schermo virtuale), a finestra non
// massimizzata: gli ultimi pixel del bordo destro li prende il sistema, e lì sta anche la barra di scorrimento del
// foglio. Il mouse di Playwright entra dritto nella pagina e salta tutto questo: qui no. Senza XTest si salta.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
  await ed.waitForSelector('.pd-elemento[data-elemento="word-count"]');
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

test('fermo sul bordo destro il pannello si apre; nella fila delle schede e scorrendo lungo il bordo no', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  const { app, ed, max, destra, y, yFila, xDentro, chiudi } = await avvia();
  try {
    expect(max, 'Filo si apre non massimizzato: è il caso da provare').toBe(false);

    // In alto a destra, nella fila delle schede (riduci, ingrandisci, chiudi): niente.
    puntatore(`move:${xDentro}:${y};wait:150;move:${destra - 1}:${yFila};wait:40;move:${destra}:${yFila + 1};wait:900`);
    expect(await aperto(ed), 'nella fila delle schede').toBe(false);

    // Lungo il bordo, in verticale come chi mira la barra di scorrimento: niente.
    const passi = [`move:${xDentro}:${y};wait:150`];
    for (let i = 0; i < 24; i++) passi.push(`move:${destra}:${y - 200 + i * 16};wait:45`);
    puntatore(passi.join(';'));
    expect(await aperto(ed), 'scorrendo lungo il bordo').toBe(false);

    // Fermo contro il bordo: la striscia si accende mentre aspetta, poi il pannello si apre.
    puntatore(`move:${xDentro}:${y};wait:150;move:${destra - 1}:${y};wait:40;move:${destra}:${y + 1};wait:120`);
    await expect(ed.locator('.pd-striscia.pd-bordo')).toHaveCount(1);
    puntatore('wait:500');
    await expect.poll(() => aperto(ed), { timeout: 2000 }).toBe(true);
    expect(await motivo(app)).toBe('spinta');
    mkdirSync(SHOTS, { recursive: true });
    await ed.screenshot({ path: `${SHOTS}/pannello-destro-aperto-dal-bordo.png` });

    // Il puntatore esce dalla finestra a destra senza passare dal pannello: il pannello si chiude.
    puntatore(`move:${destra + 40}:${y};wait:1200`);
    await expect.poll(() => aperto(ed), { timeout: 3000 }).toBe(false);
  } finally {
    await chiudi();
  }
});

test('aperto dal bordo, un clic sulla barra di scorrimento lo chiude; il pannello non la copre', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  const { ed, cb, px, destra, y, xDentro, chiudi } = await avvia();
  try {
    puntatore(`move:${xDentro}:${y};wait:150;move:${destra - 1}:${y};wait:40;move:${destra}:${y + 1};wait:800`);
    await expect.poll(() => aperto(ed), { timeout: 2000 }).toBe(true);
    // La barra di scorrimento del foglio resta all'estremo, e il pannello le sta a sinistra.
    const m = await ed.evaluate(() => {
      const w = document.getElementById('docWrap');
      const r = w.getBoundingClientRect();
      const barra = w.offsetWidth - w.clientWidth;
      return { barra, sinistraBarra: r.left + w.clientLeft + w.clientWidth, pannello: document.querySelector('.pd-pannello').getBoundingClientRect().right };
    });
    expect(m.barra).toBeGreaterThan(5);
    expect(m.pannello).toBeLessThanOrEqual(m.sinistraBarra + 0.5);
    // Clic sulla barra, oltre la fascia del sistema: si scorre, e il pannello si chiude.
    const xBarra = px(cb.x + m.sinistraBarra + 2);
    const prima = await ed.evaluate(() => document.getElementById('docWrap').scrollTop);
    puntatore(`move:${xBarra}:${y + 200};wait:80;down;wait:60;up;wait:600`);
    await expect.poll(() => aperto(ed), { timeout: 2000 }).toBe(false);
    expect(await ed.evaluate(() => document.getElementById('docWrap').scrollTop), 'il clic sulla barra fa il suo lavoro').toBeGreaterThan(prima);
  } finally {
    await chiudi();
  }
});

test('bloccato, aperto dal bordo resta aperto anche uscendo, e il foglio si restringe', async () => {
  test.skip(!xtestDisponibile(), 'serve uno schermo X con XTest (contenitore Linux sotto xvfb-run)');
  test.setTimeout(90_000);
  const { ed, destra, y, xDentro, chiudi } = await avvia({ bloccato: true });
  try {
    // Bloccato si apre già all'avvio dell'app, accanto al foglio.
    await expect.poll(() => aperto(ed), { timeout: 3000 }).toBe(true);
    // Chiuso dal suo menu, si riapre dal bordo.
    await ed.locator('.pd-testa').click({ button: 'right', position: { x: 20, y: 10 } });
    await ed.locator('.pd-menu .sn-select-option', { hasText: 'Chiudi il pannello' }).click();
    await expect.poll(() => aperto(ed)).toBe(false);
    puntatore(`move:${xDentro}:${y};wait:150;move:${destra - 1}:${y};wait:40;move:${destra}:${y + 1};wait:800`);
    await expect.poll(() => aperto(ed), { timeout: 2000 }).toBe(true);
    // Il puntatore esce dalla finestra e torna sul foglio: resta aperto.
    puntatore(`move:${destra + 40}:${y};wait:900;move:${xDentro}:${y};wait:900`);
    expect(await aperto(ed)).toBe(true);
    const m = await ed.evaluate(() => ({
      testo: document.getElementById('doc').getBoundingClientRect().right,
      pannello: document.querySelector('.pd-pannello').getBoundingClientRect().left,
      bloccato: document.documentElement.classList.contains('pd-bloccato'),
    }));
    expect(m.bloccato).toBe(true);
    expect(m.testo, 'il foglio si stringe a sinistra del pannello').toBeLessThanOrEqual(m.pannello);
  } finally {
    await chiudi();
  }
});
