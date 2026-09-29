// #588.5 giro 2, rilievo 1: dove il riquadro degli avvisi è trasparente il clic deve arrivare alla pagina.
// Mouse vero (xdotool sullo schermo virtuale): il clic di Playwright non passa dalla scelta fra le viste.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync, spawnSync } from 'node:child_process';

const haXdotool = process.platform === 'linux' && !!process.env.DISPLAY
  && spawnSync('sh', ['-c', 'command -v xdotool'], { stdio: 'ignore' }).status === 0;
test.skip(!haXdotool, 'serve xdotool su uno schermo X (contenitore delle routine)');

const xdo = (...a) => execFileSync('xdotool', a.map(String));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function aSchermo(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.setOpacity?.(1);
    w.setPosition(0, 0);
    w.setContentSize(900, 600);
    w.show();
    w.focus();
  });
  await pausa(500);
}

function geometria(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    return { c: w.getContentBounds(), t: tab.view.getBounds(), v: tm.avvisi.vista ? tm.avvisi.vista.getBounds() : null };
  });
}

async function clicSulla(app, page, sel) {
  const g = await geometria(app);
  const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  const sx = Math.round(g.c.x + g.t.x + r.x);
  const sy = Math.round(g.c.y + g.t.y + r.y);
  xdo('mousemove', sx - 5, sy - 5); xdo('mousemove', sx, sy); xdo('click', 1);
  await pausa(400);
}

test('il bordo trasparente attorno all’avviso, all’angolo della finestra, lascia arrivare il clic alla pagina', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:3000px">
    <button id="angolo" style="position:fixed;right:3px;bottom:3px;width:10px;height:10px;padding:0" onclick="window.__n=(window.__n||0)+1"></button>
    </body></html>`);
  await aSchermo(app);
  // Senza avviso il clic arriva: la prova misura la vista, non il mouse.
  await clicSulla(app, page, '#angolo');
  await expect.poll(() => page.evaluate(() => window.__n || 0)).toBe(1);

  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await expect.poll(async () => ((await geometria(app)).v || {}).width || 0).toBeGreaterThan(100);
  await clicSulla(app, page, '#angolo');
  expect(await page.evaluate(() => window.__n || 0)).toBe(2);
});

test('accanto a un avviso più stretto di quello sotto, il testo della pagina resta cliccabile', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:3000px">
    <button id="accanto" style="position:fixed;right:250px;bottom:110px;width:12px;height:12px;padding:0" onclick="window.__n=(window.__n||0)+1"></button>
    </body></html>`);
  await aSchermo(app);
  await clicSulla(app, page, '#accanto');
  await expect.poll(() => page.evaluate(() => window.__n || 0)).toBe(1);

  await shell.evaluate(() => {
    window.filoNotify('Bloccato popup', { durationSec: 0, actions: [{ label: 'Apri', onClick: () => {} }] });
    window.filoNotify('Scaricato: Relazione trimestrale definitiva (versione corretta) 2026.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] });
  });
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(2);
  await expect.poll(async () => ((await geometria(app)).v || {}).height || 0).toBeGreaterThan(150);
  // Il punto sta dentro la vista ma fuori da tutte e due le carte: lì la vista è trasparente.
  const g = await geometria(app);
  const p = await page.evaluate(() => { const b = document.getElementById('accanto').getBoundingClientRect(); return { x: b.left + 6, y: b.top + 6 }; });
  const px = g.t.x + p.x - g.v.x;
  const py = g.t.y + p.y - g.v.y;
  const fuoriDalleCarte = await vista.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && !(el && el.closest('.shell-notif'));
  }, { x: px, y: py });
  expect(fuoriDalleCarte, 'il punto di prova deve cadere nel vuoto della vista').toBe(true);
  await clicSulla(app, page, '#accanto');
  expect(await page.evaluate(() => window.__n || 0)).toBe(2);
});
