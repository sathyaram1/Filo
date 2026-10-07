// La pagina d'errore di un sito che non si carica prende il posto del suo indirizzo nella cronologia della scheda:
// Indietro da lì torna alla pagina di prima, non all'indirizzo che fallisce di nuovo (#871 giro 9).

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo, premi } from './helpers/barra.mjs';

// 192.168.1.1 punta a una porta chiusa (fixture): il sito non si carica e compare la pagina d'errore.
const ROTTO = 'http://192.168.1.1/x';
const scheda = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return { vera: t.view.webContents.getURL(), dietro: w._filoTabs.vociCronologia('indietro').map((v) => v.url) };
});
const vai = (app, u) => app.evaluate(({ BrowserWindow }, u) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, u);
}, u);
const ricarica = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.reload(w._filoTabs.activeId);
});

async function sitoPoiErrore(app, openTab, testServer) {
  const a = testServer.html('<!doctype html><title>A</title><h1>A</h1>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await vai(app, ROTTO);
  await expect.poll(async () => (await scheda(app)).vera, { timeout: 10_000 }).toMatch(/^filo:\/\/error\//);
  return a;
}

async function premiIndietro(app, barra) {
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const back = barra.locator('#nav .ico[data-id="back"]');
  await expect(back).toHaveAttribute('aria-disabled', 'false');
  await back.click();
}

test('dalla pagina d\'errore Indietro della barra torna al sito di prima, e l\'elenco non ripete l\'indirizzo fallito', async ({ app, openTab, testServer }) => {
  const a = await sitoPoiErrore(app, openTab, testServer);
  const barra = await barraPage(app);
  expect((await scheda(app)).dietro).toEqual([a]);
  await premiIndietro(app, barra);
  await expect.poll(async () => (await scheda(app)).vera, { timeout: 10_000 }).toBe(a);
});

test('dalla pagina d\'errore Alt+freccia sinistra torna al sito di prima', async ({ app, openTab, testServer }) => {
  const a = await sitoPoiErrore(app, openTab, testServer);
  await premi(app, 'tab', 'Left', ['alt']);
  await expect.poll(async () => (await scheda(app)).vera, { timeout: 10_000 }).toBe(a);
});

test('Ricarica sulla pagina d\'errore, il sito fallisce ancora: Indietro torna comunque al sito di prima', async ({ app, openTab, testServer }) => {
  const a = await sitoPoiErrore(app, openTab, testServer);
  const barra = await barraPage(app);
  await ricarica(app);
  await expect.poll(async () => (await scheda(app)).dietro, { timeout: 10_000 }).toEqual([a]);
  await expect.poll(async () => (await scheda(app)).vera).toMatch(/^filo:\/\/error\//);
  await premiIndietro(app, barra);
  await expect.poll(async () => (await scheda(app)).vera, { timeout: 10_000 }).toBe(a);
});

test('Home dalla pagina d\'errore e poi Indietro due volte: si torna al sito di prima', async ({ app, openTab, testServer }) => {
  const a = await sitoPoiErrore(app, openTab, testServer);
  const barra = await barraPage(app);
  await vai(app, 'filo://newtab/');
  await expect.poll(async () => (await scheda(app)).vera).toMatch(/^filo:\/\/newtab\//);
  expect((await scheda(app)).dietro).toEqual([ROTTO, a]);
  await premiIndietro(app, barra);
  await expect.poll(async () => (await scheda(app)).vera, { timeout: 10_000 }).toMatch(/^filo:\/\/error\//);
  await expect.poll(async () => (await scheda(app)).dietro, { timeout: 10_000 }).toEqual([a]);
  await premiIndietro(app, barra);
  await expect.poll(async () => (await scheda(app)).vera, { timeout: 10_000 }).toBe(a);
});
