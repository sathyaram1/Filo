// Esplorazione del giro 1 di #858: F11 col menu a comparsa aperto, colpi rapidi, durante un caricamento.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, statoBarra, pannelloFermo, premi, menuAperto } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  const tabs = win._filoTabs;
  const attiva = tabs.tabs.find((t) => t.id === tabs.activeId);
  return { fs: tabs.contentFullscreen, cima: attiva.view.getBounds().y, osFs: win.isFullScreen() };
});
const PAGINA = '<!doctype html><title>Sito</title><body style="margin:0"><input id="campo"></body>';

test('F11 col menu a comparsa aperto', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  await barra.locator('#fisse .ico[data-comando="history"]').click({ button: 'right' });
  const menu = await menuAperto(app);
  expect(menu).not.toBeNull();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && x.webContents.getURL().startsWith('data:') && x.isVisible());
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
  });
  await expect.poll(async () => (await stato(app)).fs, { timeout: 5000 }).toBe(true);
  await pausa(800);
  const ancora = await menuAperto(app, { tetto: 300 });
  console.log('menu ancora aperto dopo F11:', !!ancora, JSON.stringify(await statoBarra(app)));
});

test('colpi rapidi di F11 restano coerenti', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  for (let i = 0; i < 5; i++) await premi(app, 'scheda', 'F11');
  await pausa(1000);
  const s = await stato(app);
  console.log('dopo 5 colpi', JSON.stringify(s));
  expect(s.fs).toBe(true);
  expect(s.cima).toBe(0);
  for (let i = 0; i < 4; i++) await premi(app, 'shell', 'F11');
  await pausa(1000);
  const s2 = await stato(app);
  console.log('dopo altri 4', JSON.stringify(s2));
  expect(s2.fs).toBe(true);
});

test('F11 durante una navigazione', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const lenta = testServer.url ? null : null;
  await page.evaluate(() => { location.href = location.href + '?x=' + Date.now(); });
  await premi(app, 'scheda', 'F11');
  await expect.poll(async () => (await stato(app)).fs, { timeout: 5000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await pausa(500);
  await premi(app, 'scheda', 'F11');
  await expect.poll(async () => (await stato(app)).fs, { timeout: 5000 }).toBe(false);
  void lenta;
});
