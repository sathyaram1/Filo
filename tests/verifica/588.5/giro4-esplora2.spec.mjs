// Verifica #588.5 giro 4 — esplorazione: la riserva dell'angolo resta appesa? la Home è coperta?
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

test.setTimeout(90000);
const SHOTS = resolve('tests/.shots');
mkdirSync(SHOTS, { recursive: true });
function scatta(nome) { try { execFileSync('scrot', ['-o', join(SHOTS, `588.5-g4-${nome}.png`)]); } catch (_) {} }

const riserva = (p) => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--filo-avvisi-barra').trim());
const fogli = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const r = w._filoTabs.avvisi.riserve;
  const t = w._filoTabs.tabs.find((x) => x.view.webContents.getURL() === u);
  const s = t && r.get(t.view.webContents);
  return s ? { px: s.px, chiave: !!s.chiave } : null;
}, url);

async function pagina(app, url) {
  let p = null;
  await expect.poll(() => { p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }); return !!p; }, { timeout: 15000 }).toBe(true);
  await p.waitForLoadState('domcontentloaded');
  return p;
}

test('a) popup bloccato mentre la pagina carica: chiuso l’avviso, la riserva se ne va', async ({ app, shell, testServer, avvisi }) => {
  const url = testServer.html(`<!doctype html><html><body><p>pagina con popup</p><script>window.open('${testServer.html('<p>pop</p>')}');</script><p>fine</p></body></html>`);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const page = await pagina(app, url);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1, { timeout: 10000 });
  console.log('testo', await vista.locator('.shell-notif-msg').textContent());
  await expect.poll(() => riserva(page)).not.toBe('');
  await page.waitForTimeout(1500);
  await shell.evaluate(() => { for (const b of document.querySelectorAll('.shell-notif-close')) b.click(); });
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  await page.waitForTimeout(1000);
  console.log('a) riserva dopo', JSON.stringify(await riserva(page)), JSON.stringify(await fogli(app, url)));
  expect(await riserva(page)).toBe('');
});

test('b) avviso aperto, nuova scheda con un sito: chiuso l’avviso, la riserva se ne va', async ({ app, shell, testServer, avvisi }) => {
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0 }));
  await avvisi();
  const url = testServer.html('<!doctype html><html><body><p>nuova</p></body></html>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const page = await pagina(app, url);
  await expect.poll(() => riserva(page)).not.toBe('');
  await page.waitForTimeout(1500);
  await shell.evaluate(() => { for (const b of document.querySelectorAll('.shell-notif-close')) b.click(); });
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  await page.waitForTimeout(1000);
  console.log('b) riserva dopo', JSON.stringify(await riserva(page)), JSON.stringify(await fogli(app, url)));
  expect(await riserva(page)).toBe('');
});

test('c) avviso aperto, clic su un collegamento nella stessa scheda: chiuso l’avviso, la riserva se ne va', async ({ app, shell, testServer, openTab, avvisi }) => {
  const dopo = testServer.html('<!doctype html><html><body><p>dopo</p></body></html>');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body><a id="l" href="${dopo}">vai</a></body></html>`);
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0 }));
  await avvisi();
  await expect.poll(() => riserva(page)).not.toBe('');
  await page.locator('#l').click();
  await page.waitForURL(dopo);
  await expect.poll(() => riserva(page)).not.toBe('');
  await page.waitForTimeout(1500);
  await shell.evaluate(() => { for (const b of document.querySelectorAll('.shell-notif-close')) b.click(); });
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  await page.waitForTimeout(1000);
  console.log('c) riserva dopo', JSON.stringify(await riserva(page)));
  expect(await riserva(page)).toBe('');
});

test('d) Home e nome lungo: la carta copre il tasto di invio?', async ({ app, shell, avvisi }) => {
  for (const W of [1280, 960]) {
    await app.evaluate(({ BrowserWindow }, W) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setContentSize(W, 760); }, W);
    await shell.waitForTimeout(800);
    await shell.evaluate(() => window.filoNotify('Scaricato: Fattura_Energia_Elettrica_settembre_2026_…pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] }));
    const vista = await avvisi();
    await shell.waitForTimeout(900);
    const home = app.windows().find((w) => { try { return /dashboard|newtab/.test(w.url()) && !w.url().startsWith('filo://shell'); } catch (_) { return false; } });
    const g = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const tm = w._filoTabs; const t = tm.tabs.find((x) => x.id === tm.activeId);
      return { v: tm.avvisi.vista.getBounds(), t: t.view.getBounds(), url: t.view.webContents.getURL() };
    });
    const invio = await home.evaluate(() => { const r = document.getElementById('sendBtn').getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom }; });
    const carta = await vista.evaluate(() => { const r = document.querySelector('.shell-notif.show').getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom }; });
    const cx = carta.x + g.v.x - g.t.x; const cy = carta.y + g.v.y - g.t.y;
    const cr = carta.r + g.v.x - g.t.x; const cb = carta.b + g.v.y - g.t.y;
    const copre = invio.x < cr && cx < invio.r && invio.y < cb && cy < invio.b;
    console.log('d)', W, g.url, JSON.stringify({ invio, carta: { cx, cy, cr, cb }, copre }));
    scatta(`home-${W}`);
    await shell.evaluate(() => { for (const b of document.querySelectorAll('.shell-notif-close')) b.click(); });
    await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  }
});
