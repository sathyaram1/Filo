// #858 giro 1, rilievo 1: F11 premuto col menu a comparsa di Filo aperto cambia la finestra sotto il menu,
// che resta aperto dov'era. Il tasto arriva da sendInputEvent: quelli di Playwright non passano da before-input-event.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, statoBarra, pannelloFermo, menuAperto } from '../../helpers/barra.mjs';

const schermoIntero = (app) => app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.contentFullscreen);

test('r1 F11 col menu del tasto destro della barra laterale aperto: lo schermo intero entra e il menu si chiude', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><title>Sito</title><body style="margin:0"><p>testo</p></body>');
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  await barra.locator('#fisse .ico[data-comando="history"]').click({ button: 'right' });
  expect(await menuAperto(app)).not.toBeNull();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && x.isVisible() && x.webContents.getURL().startsWith('data:'));
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
  });
  await expect.poll(() => schermoIntero(app), { timeout: 5000 }).toBe(true);
  await expect.poll(async () => !!(await menuAperto(app, { tetto: 200 })), { timeout: 3000 }).toBe(false);
});
