// Il fumetto col titolo di una scheda è una finestra a sé, sotto il puntatore: non deve prendersi il
// mouse, o la barra non sa che il puntatore l'ha lasciata e dopo una chiusura le schede restano strette (#428).
// Serve il puntatore vero del sistema (xdotool su X11) e la finestra a schermo: altrove si salta.

import { execFileSync } from 'node:child_process';
import { test, expect } from './fixtures/electron.mjs';

let xdotool = false;
try { execFileSync('xdotool', ['version'], { stdio: 'ignore' }); xdotool = process.platform === 'linux' && !!process.env.DISPLAY; } catch (_) {}
// La finestra nascosta dei test non riceve il puntatore vero; l'avvio legge l'ambiente al lancio.
const nascosta = process.env.FILO_HIDE_WINDOW;
if (xdotool) delete process.env.FILO_HIDE_WINDOW;
test.afterAll(() => { if (nascosta !== undefined) process.env.FILO_HIDE_WINDOW = nascosta; });

const xdo = (...a) => execFileSync('xdotool', a.map(String));

async function larghezze(shell) {
  return shell.evaluate(() => [...document.querySelectorAll('#tabs .tab:not(.active)')].map((el) => el.getBoundingClientRect().width));
}

async function strisciaQuieta(shell) {
  for (let i = 0; i < 40; i++) {
    const n = await shell.evaluate(() => new Promise((res) => {
      let c = 0;
      const mo = new MutationObserver((l) => { for (const m of l) if (m.removedNodes.length) c++; });
      mo.observe(document.getElementById('tabs'), { childList: true });
      setTimeout(() => { mo.disconnect(); res(c); }, 500);
    }));
    if (!n) return;
  }
}

test('fermo sul fumetto sotto la fila, dopo una chiusura le schede si adattano', async ({ app, shell, testServer }) => {
  test.skip(!xdotool, 'serve xdotool su X11');
  for (let i = 0; i < 13; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>Ricetta della pasta al forno numero ${i} - Cucina di casa</title><p>${i}</p>`));
  }
  await expect(shell.locator('#tabs .tab')).toHaveCount(14, { timeout: 15_000 });
  await strisciaQuieta(shell);
  const b = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getBounds().width > 1000);
    w.focus();
    return { ...w.getContentBounds(), z: w.webContents.getZoomFactor() };
  });
  const schermo = (x, y) => [Math.round(b.x + x * b.z), Math.round(b.y + y * b.z)];

  const r = await shell.evaluate(() => document.querySelectorAll('#tabs .tab')[4].querySelector('.close').getBoundingClientRect().toJSON());
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  xdo('mousemove', ...schermo(cx - 20, cy)); await shell.waitForTimeout(100);
  xdo('mousemove', ...schermo(cx, cy)); await shell.waitForTimeout(300);
  const prima = Math.max(...await larghezze(shell));
  xdo('click', 1);
  // Il fumetto della scheda scivolata sotto il puntatore compare dopo 350 ms.
  await shell.waitForTimeout(900);
  const fumetto = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => w.isVisible() && w.getBounds().width < 1000).map((w) => w.getBounds())[0] || null);
  expect(fumetto, 'il fumetto col titolo è aperto sotto il puntatore').toBeTruthy();

  // Il puntatore scende sulla pagina e si ferma dentro il fumetto.
  const giu = fumetto.y + Math.round(fumetto.height / 2);
  xdo('mousemove', schermo(cx, cy)[0], giu);
  expect((await shell.evaluate(() => window.filoShell.puntatore())).y, 'il puntatore è sotto la fila').toBeGreaterThan(40);
  await expect.poll(async () => {
    const ora = await larghezze(shell);
    return ora.every((w) => w > prima + 0.5) ? 'adattate' : `ferme a ${prima}`;
  }, { timeout: 3_000 }).toBe('adattate');
});
