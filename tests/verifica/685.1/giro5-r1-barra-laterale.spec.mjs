// #685.1 giro 5 — su Mac Cmd+← e Cmd+→ vanno indietro e avanti solo quando non si scrive.
// r1: con la barra laterale aperta da tastiera Cmd+freccia non fa niente, Cmd+[ sì. Tasti veri, Mac simulato nel main.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, premi } from '../../helpers/barra.mjs';

const diventaMac = (app) => app.evaluate(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});
const urlAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.view.webContents.getURL();
});
const vai = (app, u) => app.evaluate(({ BrowserWindow }, u) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.navigate(w._filoTabs.activeId, u);
}, u);

async function daAaB(app, openTab, testServer, htmlB) {
  const a = testServer.html('<!doctype html><title>A</title><h1 id="a">A</h1>');
  const b = testServer.html(htmlB);
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await vai(app, b);
  await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toBe(b);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await diventaMac(app);
  return { page, a, b };
}

async function restaSu(app, url) {
  await new Promise((r) => setTimeout(r, 1200));
  expect(await urlAttiva(app)).toBe(url);
}

test('r1 barra laterale aperta da tastiera: Cmd+freccia sinistra torna indietro come Cmd+[', async ({ app, openTab, testServer }) => {
  const { a } = await daAaB(app, openTab, testServer, '<!doctype html><title>B</title><h1>B</h1>');
  await premi(app, 'tab', 'B', ['meta', 'shift']);
  await barraPage(app);
  await expect.poll(async () => (await statoBarra(app)).motivo).toBe('tasto');
  await premi(app, 'barra', 'Left', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 5_000 }).toBe(a);
});

test('r1 controllo: barra laterale aperta da tastiera, Cmd+[ torna indietro', async ({ app, openTab, testServer }) => {
  const { a } = await daAaB(app, openTab, testServer, '<!doctype html><title>B</title><h1>B</h1>');
  await premi(app, 'tab', 'B', ['meta', 'shift']);
  await barraPage(app);
  await expect.poll(async () => (await statoBarra(app)).motivo).toBe('tasto');
  await premi(app, 'barra', '[', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 5_000 }).toBe(a);
});
