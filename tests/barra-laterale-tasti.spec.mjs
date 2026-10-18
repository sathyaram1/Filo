// #871 giro 9 — aperta da tastiera la barra laterale ha il fuoco: i tasti del browser valgono lo stesso, sulla
// scheda attiva, e poi la tastiera torna a lei.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, statoBarra, pannelloFermo, premi } from './helpers/barra.mjs';

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return { n: w._filoTabs.tabs.length, url: t.url, fuocoBarra: w._filoTabs.barra.vista.webContents.isFocused() };
});

async function sitoConDuePagine(app, openTab, testServer) {
  const a = testServer.html('<!doctype html><title>A</title><h1>A</h1>');
  const b = testServer.html('<!doctype html><title>B</title><h1>B</h1>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.evaluate((u) => { location.href = u; }, b);
  await page.waitForURL(b);
  const barra = await barraPage(app);
  await premi(app, 'tab', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  await expect.poll(async () => (await stato(app)).fuocoBarra).toBe(true);
  return { a, b };
}

test('barra aperta da tastiera: Alt+freccia sinistra torna indietro e la barra si chiude', async ({ app, openTab, testServer }) => {
  const { a } = await sitoConDuePagine(app, openTab, testServer);
  await premi(app, 'barra', 'Left', ['alt']);
  await expect.poll(async () => (await stato(app)).url).toBe(a);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
});

test('barra aperta da tastiera: Ctrl+T apre una scheda nuova', async ({ app, openTab, testServer }) => {
  await sitoConDuePagine(app, openTab, testServer);
  const n = (await stato(app)).n;
  await premi(app, 'barra', 'T', ['control']);
  await expect.poll(async () => (await stato(app)).n).toBe(n + 1);
});

test('barra aperta da tastiera: Ctrl+W chiude la scheda', async ({ app, openTab, testServer }) => {
  await sitoConDuePagine(app, openTab, testServer);
  const n = (await stato(app)).n;
  await premi(app, 'barra', 'W', ['control']);
  await expect.poll(async () => (await stato(app)).n).toBe(n - 1);
});

test('barra aperta da tastiera: Esc e la sua scorciatoia restano suoi', async ({ app, openTab, testServer }) => {
  const { b } = await sitoConDuePagine(app, openTab, testServer);
  await premi(app, 'barra', 'Escape');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  expect((await stato(app)).url).toBe(b);
});
