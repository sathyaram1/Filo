// #1246 — a schermo intero le schede compaiono col puntatore fermo sul bordo alto e spariscono portandolo sulla
// pagina, con le attese della barra laterale; non per uno sfioramento, non nello schermo pieno di un video, e si spengono.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <h1>Schermo intero</h1><p id="p">Pagina di prova.</p></body></html>`;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const tm = w._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  return {
    schermoIntero: !!tm.contentFullscreen,
    visibili: tm.schedeInAlto.visibili,
    alto: t.view.getBounds().y,
    fila: tm.chromeCompact ? tm.tabRowHeight : tm.shellHeight,
    barraY: tm.barra.vista ? tm.barra.vista.getBounds().y : null,
  };
});
// Il mouse di Playwright arriva alla scheda come quello vero, senza tasti premuti (sendInputEvent li dà per premuti).
const muovi = (page, x, y) => page.mouse.move(x, y);
const schermoIntero = (app, on) => app.evaluate(({ BrowserWindow }, v) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.setContentFullscreen(v);
}, on);

test('a schermo intero, col puntatore fermo in alto le schede compaiono; portandolo sulla pagina spariscono', async ({ app, openTab, testServer, shell }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);

  await muovi(page, 400, 300);
  await muovi(page, 400, 0);
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 4000 }).toBe(true);
  const s = await stato(app);
  expect(s.alto, 'la pagina scende sotto la fila delle schede').toBe(s.fila);
  expect(s.barraY, 'la barra laterale comincia sotto le schede').toBe(s.fila);
  await expect(shell.locator('.tab').first()).toBeVisible();
  // Sulla fila il puntatore la tiene giù.
  await shell.mouse.move(200, 10);
  await pausa(700);
  expect((await stato(app)).visibili).toBe(true);

  await muovi(page, 400, 300);
  await expect.poll(async () => (await stato(app)).alto, { timeout: 4000 }).toBe(0);
  expect((await stato(app)).visibili).toBe(false);
  expect((await stato(app)).schermoIntero, 'resta a schermo intero').toBe(true);
});

test('uno sfioramento del bordo o un trascinamento non le fanno scendere, e fuori dallo schermo intero non c\'entrano', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);
  await muovi(page, 400, 0);
  await muovi(page, 400, 120);
  await pausa(700);
  expect((await stato(app)).visibili, 'passato di corsa').toBe(false);
  await page.mouse.down();
  await muovi(page, 400, 0);
  await pausa(700);
  expect((await stato(app)).visibili, 'col tasto premuto si seleziona, non si chiedono le schede').toBe(false);
  await page.mouse.up();
  await muovi(page, 400, 200);

  // Scese e poi Esc: fuori dallo schermo intero la cornice torna quella di sempre, senza schede «scese» rimaste.
  await muovi(page, 400, 0);
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 4000 }).toBe(true);
  await schermoIntero(app, false);
  await expect.poll(async () => (await stato(app)).schermoIntero).toBe(false);
  expect((await stato(app)).visibili).toBe(false);
  await muovi(page, 400, 0);
  await pausa(700);
  expect((await stato(app)).visibili).toBe(false);
});

test('nello schermo pieno di un video le schede non scendono, e da Preferenze si spengono', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);
  // Lo schermo pieno lo «chiede la pagina»: lì in alto c'è solo l'avviso col nome del sito.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    tm.pageFullscreen = true;
    tm.pageFullscreenTabId = tm.activeId;
  });
  await muovi(page, 400, 0);
  await pausa(700);
  expect((await stato(app)).visibili).toBe(false);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    tm.pageFullscreen = false;
    tm.pageFullscreenTabId = null;
  });

  await schermoIntero(app, false);

  const sito = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.activeId);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#barraSchede')).toBeChecked();
  await pref.locator('#barraSchede').uncheck();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).barraLaterale.schede)).toBe(false);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.activate(id), sito);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);
  await muovi(page, 400, 120);
  await muovi(page, 400, 0);
  await pausa(700);
  expect((await stato(app)).visibili, 'spente in Preferenze').toBe(false);
});
