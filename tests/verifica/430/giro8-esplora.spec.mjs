// Verifica #430 giro 8 — esplorazione: molte schede dietro, titolo strano, tema scuro, ultima scheda a destra, pagine di Filo.
import { writeFileSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta, verde, rosso } from './giro2-carta.mjs';

const SHOTS = 'tests/.shots';

async function fotoCarta(app, nome) {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const c = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL() === 'filo://shell/anteprima.html');
    const img = await c.webContents.capturePage();
    return img.toPNG().toString('base64');
  });
  writeFileSync(`${SHOTS}/${nome}.png`, Buffer.from(b64, 'base64'));
}

test('dodici schede aperte dietro: tutte hanno la foto', async ({ app, shell, openTab, testServer }) => {
  const urls = Array.from({ length: 12 }, (_, i) => testServer.html(pagina('#10b010', `Dietro ${i}`)));
  const corpo = urls.map((u, i) => `<a id="l${i}" href="${u}">l${i}</a>`).join('');
  const pA = await openTab(testServer.html(pagina('#e01010', 'Davanti', corpo)));
  const t0 = Date.now();
  for (let i = 0; i < urls.length; i++) await pA.click(`#l${i}`, { modifiers: ['Control'] });
  await expect.poll(async () => (await schede(app)).tutte.filter((t) => /Dietro/.test(t.title) && t.foto).length, { timeout: 40_000 }).toBe(12);
  console.log('dodici foto in ms', Date.now() - t0);
  const s = await schede(app);
  const ultima = s.tutte[s.tutte.length - 1];
  await shell.locator(`.tab[data-id="${ultima.id}"]`).hover();
  await expect.poll(async () => verde((await carta(app)).colore), { timeout: 3000 }).toBe(true);
  const c = await carta(app);
  const win = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).getContentBounds());
  console.log('carta', JSON.stringify(c.bounds), 'finestra', JSON.stringify(win));
  expect(c.bounds.x + c.bounds.width).toBeLessThanOrEqual(win.x + win.width);
  await fotoCarta(app, 'g8-ultima');
  await shell.screenshot({ path: `${SHOTS}/g8-barra.png` });
});

test('titolo lungo con markup ed emoji, poi tema scuro', async ({ app, shell, openTab, testServer }) => {
  const titolo = '<b>grassetto</b> &lt;img src=x onerror=alert(1)&gt; 🍕🍕 ' + 'parola '.repeat(60);
  const uA = testServer.html(`<!doctype html><title>${titolo.replace(/</g, '&lt;')}</title><style>body{background:#e01010}</style><h1>x</h1>`);
  await openTab(uA);
  await shell.waitForTimeout(500);
  await openTab(testServer.html(pagina('#1030d0', 'Blu')));
  const a = await idDi(app, (t) => /grassetto/.test(t.title));
  await expect.poll(async () => (await schede(app)).tutte.find((t) => t.id === a)?.foto, { timeout: 10_000 }).toBe(true);
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await expect.poll(async () => rosso((await carta(app)).colore), { timeout: 3000 }).toBe(true);
  const c = await carta(app);
  console.log('titolo carta', c.titolo.slice(0, 80), 'altezza', c.bounds.height);
  expect(c.titolo.startsWith('<b>grassetto</b>')).toBe(true);
  await fotoCarta(app, 'g8-chiaro');
  await shell.mouse.move(600, 500);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }).catch((e) => String(e)));
  await shell.waitForTimeout(1200);
  console.log('tema', await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource + ' ' + nativeTheme.shouldUseDarkColors), await shell.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg')));
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(300);
  await fotoCarta(app, 'g8-scuro');
  await shell.screenshot({ path: `${SHOTS}/g8-barra-scura.png` });
});

test('le pagine di Filo lasciate dietro hanno la foto', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://preferences/preferences.html'));
  const pref = await idDi(app, (t) => /preferences/.test(t.url));
  await shell.waitForTimeout(1200);
  await openTab(testServer.html(pagina('#1030d0', 'Blu')));
  await expect.poll(async () => (await schede(app)).tutte.find((t) => t.id === pref)?.foto, { timeout: 10_000 }).toBe(true);
  await shell.locator(`.tab[data-id="${pref}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(300);
  await fotoCarta(app, 'g8-preferenze');
});
