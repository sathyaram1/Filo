// #588.5 giro 2, rilievo 2: un clic su un avviso fuori dai suoi pulsanti non si tiene la tastiera di chi scriveva.
// Mouse e tastiera veri (xdotool sullo schermo virtuale): il fuoco fra le viste lo sposta solo un clic vero.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync, spawnSync } from 'node:child_process';

const haXdotool = process.platform === 'linux' && !!process.env.DISPLAY
  && spawnSync('sh', ['-c', 'command -v xdotool'], { stdio: 'ignore' }).status === 0;
test.skip(!haXdotool, 'serve xdotool su uno schermo X (contenitore delle routine)');

const xdo = (...a) => execFileSync('xdotool', a.map(String));
// xdotool conta in pixel fisici, Electron in pixel logici (FILO_TEST_SCALE).
const vai = (g, x, y) => xdo('mousemove', Math.round(x * g.s), Math.round(y * g.s));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function geometria(app) {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    return { s: screen.getPrimaryDisplay().scaleFactor, c: w.getContentBounds(), t: tab.view.getBounds(), v: tm.avvisi.vista ? tm.avvisi.vista.getBounds() : null };
  });
}

test('un clic sul testo di un avviso: quello che si scrive dopo arriva ancora al campo della pagina', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><input id="campo" style="margin:40px;width:300px"></body></html>`);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.setOpacity?.(1); w.setPosition(0, 0); w.setContentSize(900, 600); w.show(); w.focus();
  });
  await pausa(500);
  const g0 = await geometria(app);
  const r = await page.evaluate(() => { const b = document.getElementById('campo').getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; });
  vai(g0, g0.c.x + g0.t.x + r.x, g0.c.y + g0.t.y + r.y); xdo('click', 1);
  xdo('type', '--delay', '40', 'ab');
  await expect.poll(() => page.evaluate(() => document.getElementById('campo').value)).toBe('ab');

  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect.poll(async () => ((await geometria(app)).v || {}).width || 0).toBeGreaterThan(100);
  const g = await geometria(app);
  const sel = '.shell-notif-msg';
  const m = await vista.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + 10, y: b.top + b.height / 2 }; }, sel);
  vai(g, g.c.x + g.v.x + m.x, g.c.y + g.v.y + m.y); xdo('click', 1);
  await pausa(300);
  xdo('type', '--delay', '40', 'cd');
  await expect.poll(() => page.evaluate(() => document.getElementById('campo').value), { timeout: 3000 }).toBe('abcd');
});
