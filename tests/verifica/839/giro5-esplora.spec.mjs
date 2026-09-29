// Esplorazione del giro 5 di #839: aspetto della conferma nei due temi, miniatura con il menu aperto, Alt+S di fila.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const PAGINA = (titolo, colore = '#a1c4fd') => `<!doctype html><html><head><title>${titolo}</title></head>
  <body style="margin:0;min-height:100vh;background:linear-gradient(135deg,#f6d365,${colore})">
  <h1 style="font:40px Georgia;padding:30px">${titolo}</h1>
  <p style="font:16px Georgia;padding:0 30px">${'Testo della pagina da mettere da parte. '.repeat(40)}</p></body></html>`;

const altS = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  globalThis.__filoShortcuts.dispatch('save-for-later', win);
});
const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.url));
const salvaMiniatura = async (app, url, nome) => {
  const t = await app.evaluate(async (_e, u) => (await globalThis.SN_SAVED_PAGES.list()).find((p) => p.url === u)?.thumbnail || '', url);
  mkdirSync('tests/.shots', { recursive: true });
  if (t) writeFileSync(`tests/.shots/${nome}.jpg`, Buffer.from(t.slice(t.indexOf(',') + 1), 'base64'));
  return t.length;
};

test('conferma in tema scuro, su pagina web', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  const url = testServer.html(PAGINA('Scuro web'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await altS(app);
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/g5-scuro-web.png' });
  await salvaMiniatura(app, url, 'g5-miniatura-altS');
});

test('conferma di ripiego su pagina di Filo in tema scuro', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  const davanti = await openTab('filo://home/home.html');
  await davanti.waitForLoadState('domcontentloaded');
  const url = testServer.html(PAGINA('Bloccata'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 8000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  await altS(app);
  await expect(davanti.locator('.sn-save-confirm')).toBeVisible({ timeout: 12000 });
  await davanti.waitForTimeout(400);
  await davanti.screenshot({ path: 'tests/.shots/g5-scuro-filo.png' });
});

test('miniatura dal menu e da Alt+S col menu aperto', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGINA('Col menu', '#fda085'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.click('body', { button: 'right', position: { x: 300, y: 200 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await altS(app);
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(500);
  await salvaMiniatura(app, url, 'g5-miniatura-menu-aperto-altS');

  const url2 = testServer.html(PAGINA('Dal menu', '#c2e9fb'));
  const p2 = await openTab(url2);
  await p2.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await p2.click('body', { button: 'right', position: { x: 300, y: 200 } });
  await p2.locator('.sn-menu [data-sn-icon-id="saveForLater"]').click();
  await expect(p2.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  await p2.waitForTimeout(500);
  await salvaMiniatura(app, url2, 'g5-miniatura-menu');
});

test('Alt+S tre volte di fila su tre schede', async ({ app, openTab, testServer }) => {
  const urls = [];
  for (const n of ['Uno', 'Due', 'Tre']) {
    const u = testServer.html(PAGINA(n));
    urls.push(u);
    const p = await openTab(u);
    await p.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  }
  for (let i = 0; i < 3; i++) { await altS(app); await new Promise((r) => setTimeout(r, 600)); }
  const salvate = await app.evaluate(async (_e, us) => (await globalThis.SN_SAVED_PAGES.list()).filter((p) => us.includes(p.url)).length, urls);
  const aperte = (await schede(app)).filter((u) => urls.includes(u)).length;
  console.log('DOPO 1.8s: salvate', salvate, 'aperte', aperte);
  await new Promise((r) => setTimeout(r, 5000));
  const salvate2 = await app.evaluate(async (_e, us) => (await globalThis.SN_SAVED_PAGES.list()).filter((p) => us.includes(p.url)).length, urls);
  const aperte2 = (await schede(app)).filter((u) => urls.includes(u)).length;
  console.log('DOPO 6.8s: salvate', salvate2, 'aperte', aperte2);
});

test('griglia di Aperti per dopo con le miniature nuove', async ({ app, openTab, testServer }) => {
  for (const [n, c] of [['Ricette', '#fda085'], ['Viaggi', '#a1c4fd'], ['Lavoro', '#c2e9fb']]) {
    const u = testServer.html(PAGINA(n, c));
    const p = await openTab(u);
    await p.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await p.click('body', { button: 'right', position: { x: 300, y: 200 } });
    await p.locator('.sn-menu [data-sn-icon-id="saveForLater"]').click();
    await expect(p.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
    await p.waitForTimeout(300);
  }
  const home = await openTab('filo://home/home.html');
  await home.waitForLoadState('domcontentloaded');
  await home.waitForTimeout(1500);
  await home.screenshot({ path: 'tests/.shots/g5-griglia.png' });
});
