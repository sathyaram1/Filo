// Verifica #430 giro 6 — esplorazione: aspetto in chiaro e scuro, titoli strani, ultima scheda, visibilità delle schede dietro.
import { execFileSync } from 'node:child_process';
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta, rosso } from './giro2-carta.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const scatta = (nome) => { try { execFileSync('scrot', ['-o', `tests/.shots/430-g6-${nome}.png`]); } catch (_) {} };

async function apri(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const id = await idDi(app, (t) => t.url === url);
  await expect.poll(async () => (await schede(app)).attiva, { timeout: 5000 }).toBe(id);
  return id;
}

test('aspetto della carta, titolo lungo con markup ed emoji, chiaro e scuro', async ({ app, shell, testServer }) => {
  const lungo = '<b>grassetto</b> 🎉🍕 ' + 'parola '.repeat(60);
  const a = await apri(app, shell, testServer.html(pagina('#e01010', lungo.replace(/</g, '&lt;'))));
  await pausa(500);
  await apri(app, shell, testServer.html(pagina('#1030e0', 'Blu')));
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === a).foto, { timeout: 10_000 }).toBe(true);
  for (const tema of ['light', 'dark']) {
    await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
    await pausa(500);
    await shell.locator('#tab-new').hover();
    await pausa(300);
    await shell.locator(`.tab[data-id="${a}"]`).hover();
    await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
    await pausa(300);
    const c = await carta(app);
    console.log(tema, JSON.stringify({ titolo: c.titolo.slice(0, 40), bounds: c.bounds, colore: c.colore }));
    expect(c.titolo.startsWith('<b>grassetto</b>')).toBe(true);
    expect(rosso(c.colore)).toBe(true);
    scatta(`carta-${tema}`);
  }
});

test('ultima scheda a destra: la carta resta dentro la finestra', async ({ app, shell, testServer }) => {
  const ids = [];
  for (let i = 0; i < 9; i++) ids.push(await apri(app, shell, testServer.html(pagina(i % 2 ? '#1030e0' : '#e01010', `S${i}`))));
  await shell.evaluate((id) => window.filoShell.tabs.activate?.(id), ids[0]);
  await pausa(800);
  const ultima = ids[ids.length - 1];
  await shell.locator(`.tab[data-id="${ultima}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  const c = await carta(app);
  const win = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).getContentBounds());
  console.log('ultima', JSON.stringify({ carta: c.bounds, win, colore: c.colore, attiva: (await schede(app)).attiva, ultima }));
  expect(c.bounds.x + c.bounds.width).toBeLessThanOrEqual(win.x + win.width);
  scatta('ultima');
});

test('visibilità delle schede dietro: aperta con Ctrl, lasciata e poi cambiata da sola', async ({ app, shell, testServer }) => {
  const spia = `<script>window.__vis=[document.visibilityState];document.addEventListener('visibilitychange',()=>__vis.push(document.visibilityState+'@'+Math.round(performance.now())));
  window.__raf=0;(function f(){__raf++;requestAnimationFrame(f)})();</script>`;
  const dietroUrl = testServer.html(pagina('#10a020', 'Dietro', spia));
  const lasciataUrl = testServer.html(pagina('#e01010', 'Lasciata', spia + `<script>window.vaiAvanti=()=>{history.pushState({}, '', '?p=2');document.title='Lasciata 2';document.body.style.background='#10a020'}</script>`));
  const lasciata = await apri(app, shell, lasciataUrl);
  const davantiUrl = testServer.html(pagina('#1030e0', 'Davanti', `<a id="vai" href="${dietroUrl}">link</a>`));
  await pausa(500);
  await apri(app, shell, davantiUrl);
  const page = app.windows().find((w) => w.url() === davantiUrl);
  await page.click('#vai', { modifiers: ['Control'] });
  const dietro = await idDi(app, (t) => t.url === dietroUrl);
  await pausa(8000);
  const stato = async (id) => app.evaluate(async ({ BrowserWindow }, id) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.find((x) => x.id === id);
    const a = await t.view.webContents.executeJavaScript('({vis: document.visibilityState, storia: window.__vis, raf: window.__raf})');
    await new Promise((r) => setTimeout(r, 1000));
    const b = await t.view.webContents.executeJavaScript('window.__raf');
    return { ...a, rafAlSecondo: b - a.raf, visibile: t.view.getVisible?.(), bounds: t.view.getBounds() };
  }, id);
  console.log('ctrl-clic dopo 8s', JSON.stringify(await stato(dietro)));
  console.log('lasciata dopo 8s', JSON.stringify(await stato(lasciata)));
  // La lasciata, ferma da più di venti secondi, cambia pagina da sola senza ricaricare.
  await pausa(14_000);
  await app.evaluate(async ({ BrowserWindow }, id) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.find((x) => x.id === id);
    await t.view.webContents.executeJavaScript('vaiAvanti()');
  }, lasciata);
  await pausa(10_000);
  console.log('lasciata dopo il cambio', JSON.stringify(await stato(lasciata)));
  await shell.locator(`.tab[data-id="${lasciata}"]`).hover();
  await pausa(600);
  const c = await carta(app);
  console.log('carta lasciata', JSON.stringify({ titolo: c.titolo, colore: c.colore }));
});
