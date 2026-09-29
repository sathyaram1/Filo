// Esplorazione del giro 2 di #588.5 col mouse vero (xdotool sullo schermo virtuale): cosa copre la vista.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';

const xdo = (...a) => execFileSync('xdotool', a.map(String));

async function inVista(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.setOpacity?.(1);
    w.setPosition(0, 0);
    w.setContentSize(900, 600);
    w.show();
    w.focus();
  });
  await new Promise((r) => setTimeout(r, 500));
}

function geometria(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    return { c: w.getContentBounds(), t: tab.view.getBounds(), v: tm.avvisi.vista ? tm.avvisi.vista.getBounds() : null };
  });
}

test.skip(!process.env.DISPLAY, 'serve lo schermo virtuale');

test('il margine trasparente attorno alla carta lascia passare il clic alla pagina', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:3000px">
    <button id="angolo" style="position:fixed;right:3px;bottom:3px;width:10px;height:10px;padding:0" onclick="window.__n=(window.__n||0)+1"></button>
    </body></html>`);
  await inVista(app);
  const g0 = await geometria(app);
  const r = await page.evaluate(() => { const b = document.getElementById('angolo').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const sx = Math.round(g0.c.x + g0.t.x + r.x);
  const sy = Math.round(g0.c.y + g0.t.y + r.y);
  // Controllo: senza avviso il clic arriva.
  xdo('mousemove', sx, sy); xdo('click', 1);
  await expect.poll(() => page.evaluate(() => window.__n || 0)).toBe(1);
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect.poll(async () => ((await geometria(app)).v || {}).width || 0).toBeGreaterThan(100);
  const g = await geometria(app);
  console.log('geometria', JSON.stringify(g), 'clic a', sx, sy);
  xdo('mousemove', sx - 5, sy - 5); xdo('mousemove', sx, sy); xdo('click', 1);
  await new Promise((res) => setTimeout(res, 400));
  const n = await page.evaluate(() => window.__n || 0);
  console.log('clic arrivati alla pagina con avviso', n);
  expect(n).toBe(2);
});

test('un clic sul testo della carta non toglie la tastiera al campo in cui si scriveva', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><input id="campo" style="margin:40px;width:300px"></body></html>`);
  await inVista(app);
  const g0 = await geometria(app);
  const r = await page.evaluate(() => { const b = document.getElementById('campo').getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; });
  xdo('mousemove', Math.round(g0.c.x + g0.t.x + r.x), Math.round(g0.c.y + g0.t.y + r.y)); xdo('click', 1);
  xdo('type', '--delay', '40', 'ab');
  await expect.poll(() => page.evaluate(() => document.getElementById('campo').value)).toBe('ab');
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  xdo('type', '--delay', '40', 'cd');
  await expect.poll(() => page.evaluate(() => document.getElementById('campo').value)).toBe('abcd');
  await expect.poll(async () => ((await geometria(app)).v || {}).width || 0).toBeGreaterThan(100);
  const g = await geometria(app);
  const m = await vista.evaluate(() => { const b = document.querySelector('.shell-notif-msg').getBoundingClientRect(); return { x: b.left + 10, y: b.top + b.height / 2 }; });
  xdo('mousemove', Math.round(g.c.x + g.v.x + m.x), Math.round(g.c.y + g.v.y + m.y)); xdo('click', 1);
  await new Promise((res) => setTimeout(res, 300));
  xdo('type', '--delay', '40', 'ef');
  await new Promise((res) => setTimeout(res, 500));
  const v = await page.evaluate(() => document.getElementById('campo').value);
  const f = await app.evaluate(({ webContents }) => { const x = webContents.getFocusedWebContents(); return x ? x.getURL() : ''; });
  console.log('valore dopo il clic sulla carta', v, 'fuoco', f);
  expect(v).toBe('abcdef');
});
