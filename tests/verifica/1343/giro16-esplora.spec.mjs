// Verifica #1343 giro 16: esplorazione a schermo intero, schede scoperte e cambio di scheda, nuova scheda, home.

import { test, expect } from '../../fixtures/electron.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const sito = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px"><h1>${t}</h1></body></html>`;
const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  return { visibili: tm.schedeInAlto.visibili, alto: t.view.getBounds().y, fila: tm.chromeCompact ? tm.tabRowHeight : tm.shellHeight, url: t.view.webContents.getURL(), n: tm.tabs.length };
});
const schermoIntero = (app, on) => app.evaluate(({ BrowserWindow }, v) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.setContentFullscreen(v);
}, on);

async function scopri(app, page) {
  await page.mouse.move(400, 300);
  await page.mouse.move(400, 0, { steps: 4 });
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 4000 }).toBe(true);
}

test('esplora: clic su un\'altra scheda della fila scoperta', async ({ app, shell, openTab, testServer }) => {
  const prima = await testServer.openReady(openTab, sito('Prima'));
  const seconda = await testServer.openReady(openTab, sito('Seconda'));
  await schermoIntero(app, true);
  await pausa(600);
  await scopri(app, seconda);
  const tab = shell.locator('.tab:has-text("Prima")').first();
  const b = await tab.boundingBox();
  await shell.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await tab.click();
  await expect.poll(async () => (await stato(app)).url).toContain(new URL(prima.url()).host);
  const s = await stato(app);
  console.log('dopo il clic', JSON.stringify(s));
  expect(s.alto, 'la scheda nuova davanti sta sotto la fila').toBe(s.fila);
  await prima.mouse.move(400, 300);
  await prima.mouse.move(420, 320);
  await expect.poll(async () => (await stato(app)).alto, { timeout: 4000 }).toBe(0);
  await pausa(300);
  // Di nuovo in alto sulla scheda appena scelta.
  await scopri(app, prima);
});

test('esplora: «+» nella fila scoperta e poi la home', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, sito('Sito'));
  await schermoIntero(app, true);
  await pausa(600);
  await scopri(app, page);
  const piu = shell.locator('#tab-new');
  const b = await piu.boundingBox();
  await shell.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const n = (await stato(app)).n;
  await piu.click();
  await expect.poll(async () => (await stato(app)).n).toBe(n + 1);
  const s = await stato(app);
  console.log('nuova scheda', JSON.stringify(s));
  expect(s.alto).toBe(s.fila);
  let home = null;
  await expect.poll(() => { home = app.windows().filter((w) => w.url().startsWith('filo://newtab')).pop(); return !!home; }).toBe(true);
  await home.waitForLoadState('domcontentloaded');
  await home.mouse.move(400, 300);
  await home.mouse.move(420, 320);
  await expect.poll(async () => (await stato(app)).alto, { timeout: 4000 }).toBe(0);
  await pausa(400);
  await scopri(app, home);
});
