// #871 giro 9, rilievo 1: dalla pagina d'errore di un sito che non si carica, Indietro della barra torna alla pagina di prima.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
// 192.168.1.1 punta a una porta chiusa (fixture): il sito non si carica e compare la pagina d'errore.
const ROTTO = 'http://192.168.1.1/x';
const scheda = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return { url: t.url, vera: t.view.webContents.getURL(), dietro: w._filoTabs.vociCronologia('indietro').map((v) => v.url) };
});
const vai = (app, u) => app.evaluate(({ BrowserWindow }, u) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, u);
}, u);

async function premiIndietro(app, barra) {
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const back = barra.locator('#nav .ico[data-id="back"]');
  await expect(back).toHaveAttribute('aria-disabled', 'false');
  await back.click();
}

test('r1 dalla pagina d\'errore Indietro riporta al sito di prima', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><h1>A</h1>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  const barra = await barraPage(app);
  await vai(app, ROTTO);
  await expect.poll(async () => (await scheda(app)).vera, { timeout: 10_000 }).toMatch(/^filo:\/\/error\//);
  await premiIndietro(app, barra);
  await expect.poll(async () => (await scheda(app)).vera, { timeout: 10_000 }).toBe(a);
});

test('r1 Home dalla pagina d\'errore e poi Indietro due volte: si torna al sito di prima', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><h1>A</h1>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  const barra = await barraPage(app);
  await vai(app, ROTTO);
  await expect.poll(async () => (await scheda(app)).vera, { timeout: 10_000 }).toMatch(/^filo:\/\/error\//);
  await vai(app, 'filo://newtab/');
  await expect.poll(async () => (await scheda(app)).vera).toMatch(/^filo:\/\/newtab\//);
  await premiIndietro(app, barra);
  await expect.poll(async () => (await scheda(app)).vera, { timeout: 10_000 }).toMatch(/^filo:\/\/error\//);
  await pausa(500);
  await premiIndietro(app, barra);
  await expect.poll(async () => (await scheda(app)).vera, { timeout: 10_000 }).toBe(a);
});
