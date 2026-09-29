// Verifica #588.5 giro 5 — tema scuro dalle Preferenze e zoom di sistema: come si vede e dove si clicca.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SHOTS = resolve('tests/.shots');
mkdirSync(SHOTS, { recursive: true });
test.setTimeout(120000);
test.skip(!process.env.DISPLAY, 'serve lo schermo virtuale');
const xdo = (...a) => execFileSync('xdotool', a.map(String));
const scala = process.env.FILO_TEST_SCALE || '1';
function scatta(nome) {
  const p = join(SHOTS, `588.5-g5-${nome}-${scala}.png`);
  try { execFileSync('scrot', ['-o', p]); } catch (e) { console.log('scrot', e.message); }
  return p;
}
async function contenuto(app) {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const v = win._filoTabs.avvisi.vista;
    return { s: screen.getPrimaryDisplay().scaleFactor, c: win.getContentBounds(), vista: v ? v.getBounds() : null };
  });
}

test('tema scuro dalle Preferenze: la carta segue la barra; clic vero su «Apri cartella» allo zoom di sistema', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:100vh;background:#fff;font:16px sans-serif"><p style="padding:40px">Pagina chiara con del testo.</p></body></html>`);
  await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE({ type: MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' });
  });
  // Nel contenitore il tema del sistema non arriva alle pagine: lo si emula sulla barra, che lo passa alla vista.
  await shell.emulateMedia({ colorScheme: 'dark' });
  await app.evaluate(({ shell: sh }) => { globalThis.__cartelle = []; sh.showItemInFolder = (p) => { globalThis.__cartelle.push(p); }; });
  await shell.evaluate(() => window.filoNotify('Scaricato: Fattura_settembre_2026.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => { window.__apri = (window.__apri || 0) + 1; } }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await page.waitForTimeout(1500);
  const colori = {
    carta: await vista.evaluate(() => getComputedStyle(document.querySelector('.shell-notif')).backgroundColor),
    testo: await vista.evaluate(() => getComputedStyle(document.querySelector('.shell-notif')).color),
    barra: await shell.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tab-active').trim()),
  };
  console.log('scuro', JSON.stringify(colori));
  scatta('scuro');
  const k = await contenuto(app);
  const b = await vista.evaluate(() => { const r = [...document.querySelectorAll('.shell-notif-action')].find((x) => /cartella/.test(x.textContent)).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  xdo('mousemove', '--sync', Math.round((k.c.x + k.vista.x + b.x) * k.s), Math.round((k.c.y + k.vista.y + b.y) * k.s));
  await page.waitForTimeout(500);
  scatta('scuro-hover');
  xdo('click', 1);
  await expect.poll(() => shell.evaluate(() => window.__apri || 0), { timeout: 4000 }).toBe(1);
  // Tornato al chiaro con un avviso aperto: la carta cambia con la barra.
  await shell.evaluate(() => window.filoNotify('Avviso nel passaggio di tema', { durationSec: 0 }));
  await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE({ type: MSG.UPDATE_SETTINGS, settings: { theme: 'light' } }, { url: 'filo://preferences/preferences.html' });
  });
  await shell.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(800);
  const chiaro = await vista.evaluate(() => getComputedStyle(document.querySelector('.shell-notif.show')).backgroundColor);
  console.log('tornato chiaro', chiaro);
  scatta('chiaro');
});
