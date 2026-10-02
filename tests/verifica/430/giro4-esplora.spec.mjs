// Verifica #430 giro 4 — esplorazione: chiusura con la X, clic, home, tema scuro, titolo lungo.
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede, idDi, carta, verde, rosso } from './giro2-carta.mjs';

const SHOTS = 'tests/.shots/430-giro4';
mkdirSync(SHOTS, { recursive: true });

async function apri(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const id = await idDi(app, (t) => t.url === url);
  await expect.poll(async () => (await schede(app)).attiva, { timeout: 5000 }).toBe(id);
  await new Promise((r) => setTimeout(r, 400));
  return id;
}

async function fotoCarta(app, nome) {
  await app.evaluate(async ({ BrowserWindow }, nome) => {
    const c = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL() === 'filo://shell/anteprima.html');
    if (!c) return;
    const img = await c.webContents.capturePage();
    require('node:fs').writeFileSync(nome, img.toPNG());
  }, `${process.cwd()}/${SHOTS}/${nome}.png`);
}

test('chiudere con la X la scheda sotto il puntatore: cosa mostra la carta', async ({ app, shell, testServer }) => {
  const a = await apri(app, shell, testServer.html(pagina('#e01010', 'Rossa A')));
  const b = await apri(app, shell, testServer.html(pagina('#10b010', 'Verde B')));
  const c = await apri(app, shell, testServer.html(pagina('#1030d0', 'Blu C')));
  const d = await apri(app, shell, testServer.html(pagina('#e01010', 'Rossa D')));
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(800);
  await shell.locator(`.tab[data-id="${b}"]`).hover();
  await expect.poll(async () => (await carta(app)).titolo, { timeout: 3000 }).toBe('Verde B');
  const box = await shell.locator(`.tab[data-id="${b}"] .close`).boundingBox();
  await shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await shell.waitForTimeout(300);
  const prima = await carta(app);
  console.log('PRIMA DEL CLIC', JSON.stringify({ v: prima.visibile, m: prima.mostrata, t: prima.titolo }));
  await shell.mouse.down();
  await shell.mouse.up();
  const log = [];
  for (let i = 0; i < 12; i++) {
    const k = await carta(app);
    const sotto = await shell.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.tab')?.textContent || null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    log.push({ ms: i * 100, v: k.visibile, m: k.mostrata, t: k.titolo, sotto, col: k.colore });
    await shell.waitForTimeout(100);
  }
  console.log('DOPO LA X', JSON.stringify(log));
  const tabs = await schede(app);
  console.log('SCHEDE', JSON.stringify(tabs.tutte.map((t) => t.title)));
  expect(log.some((x) => x.m && x.t === 'Verde B')).toBe(false);
});

test('clic su una scheda dietro: la carta sparisce e non riappare; poi la vicina ha la sua foto', async ({ app, shell, testServer }) => {
  const a = await apri(app, shell, testServer.html(pagina('#e01010', 'Rossa A')));
  const b = await apri(app, shell, testServer.html(pagina('#10b010', 'Verde B')));
  await apri(app, shell, testServer.html(pagina('#1030d0', 'Blu C')));
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(800);
  await shell.locator(`.tab[data-id="${b}"]`).hover();
  await expect.poll(async () => verde((await carta(app)).colore), { timeout: 3000 }).toBe(true);
  await fotoCarta(app, 'carta-chiara');
  await shell.locator(`.tab[data-id="${b}"]`).click();
  await expect.poll(async () => (await schede(app)).attiva, { timeout: 3000 }).toBe(b);
  await shell.waitForTimeout(800);
  const k = await carta(app);
  console.log('DOPO CLIC', JSON.stringify({ v: k.visibile, m: k.mostrata, t: k.titolo }));
  expect(k.visibile && k.mostrata).toBe(false);
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await expect.poll(async () => rosso((await carta(app)).colore), { timeout: 3000 }).toBe(true);
});

test('la home lasciata dietro ha la sua foto; titolo lunghissimo con emoji e HTML; tema scuro', async ({ app, shell, testServer }) => {
  const home = await apri(app, shell, 'filo://newtab/');
  await shell.waitForTimeout(1500);
  const lungo = '<b>grassetto</b> 🎉🎉 ' + 'Titolo lunghissimo di una pagina che non finisce mai '.repeat(6);
  const pag = testServer.html(`<!doctype html><title>${lungo.replace(/</g, '&lt;')}</title><style>html,body{margin:0;height:100%;background:#10b010}</style><h1>Lungo</h1>`);
  const l = await apri(app, shell, pag);
  const c = await apri(app, shell, testServer.html(pagina('#1030d0', 'Blu C')));
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(800);
  await shell.locator(`.tab[data-id="${home}"]`).hover();
  await expect.poll(async () => (await carta(app)).mostrata, { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(300);
  const kh = await carta(app);
  console.log('HOME', JSON.stringify({ t: kh.titolo, foto: !!kh.foto, col: kh.colore, b: kh.bounds }));
  await fotoCarta(app, 'carta-home');
  await shell.locator(`.tab[data-id="${l}"]`).hover();
  await expect.poll(async () => (await carta(app)).titolo.includes('grassetto'), { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(300);
  const kl = await carta(app);
  console.log('LUNGO', JSON.stringify({ t: kl.titolo, b: kl.bounds }));
  await fotoCarta(app, 'carta-lunga');
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(1500);
  await shell.locator(`.tab[data-id="${home}"]`).hover();
  await expect.poll(async () => (await carta(app)).mostrata, { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(400);
  await fotoCarta(app, 'carta-home-scura');
  await shell.locator(`.tab[data-id="${l}"]`).hover();
  await shell.waitForTimeout(400);
  await fotoCarta(app, 'carta-lunga-scura');
  // Tutta la finestra con la carta sopra.
  const shot = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const img = await w.webContents.capturePage();
    return img.toPNG().toString('base64');
  });
  require('node:fs').writeFileSync(`${SHOTS}/shell-scura.png`, Buffer.from(shot, 'base64'));
});
