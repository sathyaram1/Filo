import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta, verde, rosso } from './giro2-carta.mjs';

const SHOTS = 'tests/.shots/430-g3';
mkdirSync(SHOTS, { recursive: true });
const scatta = (nome) => { try { execFileSync('scrot', ['-o', `${SHOTS}/${nome}.png`]); } catch (e) { console.log('scrot', e.message); } };

async function apri(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const id = await idDi(app, (t) => t.url === url);
  await expect.poll(async () => (await schede(app)).attiva, { timeout: 5000 }).toBe(id);
  await new Promise((r) => setTimeout(r, 400));
  return id;
}

test('esplora: aspetto chiaro e scuro, titolo lungo', async ({ app, shell, testServer }) => {
  const lungo = 'Ricetta della pizza napoletana <b>vera</b> & 🍕 con impasto a lunga lievitazione, forno a legna e tutti i trucchi del mestiere spiegati passo passo';
  const r = await apri(app, shell, testServer.html(pagina('#e01010', lungo)));
  const g = await apri(app, shell, testServer.html(pagina('#10a020', 'Verde')));
  const b = await apri(app, shell, testServer.html(pagina('#1030e0', 'Blu')));
  await expect.poll(async () => (await schede(app)).tutte.find((t) => t.id === g).foto, { timeout: 10_000 }).toBe(true);
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(700);
  await shell.locator(`.tab[data-id="${r}"]`).hover();
  await expect.poll(async () => rosso((await carta(app)).colore), { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(300);
  const c1 = await carta(app);
  console.log('chiaro', JSON.stringify({ titolo: c1.titolo, bounds: c1.bounds }));
  scatta('chiaro-lungo');
  await shell.locator(`.tab[data-id="${g}"]`).hover();
  await shell.waitForTimeout(300);
  scatta('chiaro-verde');
  await shell.locator(`.tab[data-id="${b}"]`).hover();
  await shell.waitForTimeout(300);
  scatta('chiaro-attiva');
  await shell.mouse.move(600, 500);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await shell.waitForTimeout(1200);
  await shell.locator(`.tab[data-id="${g}"]`).hover();
  await expect.poll(async () => verde((await carta(app)).colore), { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(300);
  scatta('scuro-verde');
  await shell.locator(`.tab[data-id="${r}"]`).hover();
  await shell.waitForTimeout(300);
  scatta('scuro-lungo');
  await shell.locator(`.tab[data-id="${b}"]`).hover();
  await shell.waitForTimeout(300);
  scatta('scuro-attiva');
});

test('esplora: dieci schede aperte dietro, passaggio veloce', async ({ app, shell, testServer }) => {
  const colori = ['#e01010', '#10a020', '#1030e0', '#e0a010', '#a010e0', '#10a0a0', '#e01080', '#808010', '#104080', '#e06010'];
  const urls = colori.map((c, i) => testServer.html(pagina(c, `Pagina ${i}`)));
  const links = urls.map((u, i) => `<a id="l${i}" href="${u}">l${i}</a>`).join('');
  const davantiUrl = testServer.html(pagina('#ffffff', 'Indice', links));
  await apri(app, shell, davantiUrl);
  const page = app.windows().find((w) => w.url() === davantiUrl);
  const t0 = Date.now();
  for (let i = 0; i < urls.length; i++) await page.click(`#l${i}`, { modifiers: ['Control'] });
  const tempi = {};
  await expect.poll(async () => {
    const s = await schede(app);
    for (const t of s.tutte) if (t.foto && !(t.url in tempi)) tempi[t.url] = Date.now() - t0;
    return urls.every((u) => u in tempi);
  }, { timeout: 30_000, intervals: [200] }).toBe(true);
  console.log('tempi foto (ms)', JSON.stringify(urls.map((u) => tempi[u])));
  const s = await schede(app);
  const ids = urls.map((u) => s.tutte.find((t) => t.url === u).id);
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(700);
  for (const id of ids) {
    const box = await shell.locator(`.tab[data-id="${id}"]`).boundingBox();
    await shell.mouse.move(box.x + 10, box.y + box.height / 2, { steps: 2 });
    await shell.waitForTimeout(40);
  }
  await shell.waitForTimeout(400);
  const c = await carta(app);
  console.log('ultima', JSON.stringify({ titolo: c.titolo, colore: c.colore, visibile: c.visibile }));
  scatta('dieci-ultima');
  expect(c.titolo).toBe('Pagina 9');
});

test('esplora: chiudere la scheda sotto la carta, pagina interna dietro', async ({ app, shell, testServer }) => {
  const pref = await apri(app, shell, 'filo://preferences/preferences.html');
  const x = await apri(app, shell, testServer.html(pagina('#e01010', 'Da chiudere')));
  await apri(app, shell, testServer.html(pagina('#10a020', 'Davanti')));
  await expect.poll(async () => (await schede(app)).tutte.find((t) => t.id === x).foto, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await schede(app)).tutte.find((t) => t.id === pref).foto, { timeout: 10_000 }).toBe(true);
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(700);
  await shell.locator(`.tab[data-id="${pref}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(300);
  console.log('pref', JSON.stringify(await carta(app)));
  scatta('interna');
  await shell.locator(`.tab[data-id="${x}"]`).hover();
  await expect.poll(async () => rosso((await carta(app)).colore), { timeout: 3000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.closeTab(id), x);
  await shell.waitForTimeout(700);
  const dopo = await carta(app);
  console.log('dopo chiusura', JSON.stringify({ visibile: dopo.visibile, mostrata: dopo.mostrata, titolo: dopo.titolo, colore: dopo.colore }));
  scatta('dopo-chiusura');
});
