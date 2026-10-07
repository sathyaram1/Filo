// #685.1 giro 3 — dalla pagina d'errore di un indirizzo sbagliato si deve poter tornare alla pagina di prima.
import { test, expect } from '../../fixtures/electron.mjs';

function premi(app, keyCode, modifiers) {
  return app.evaluate(({ BrowserWindow }, arg) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: arg.keyCode, modifiers: arg.modifiers });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: arg.keyCode, modifiers: arg.modifiers });
  }, { keyCode, modifiers });
}
const urlAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.view.webContents.getURL();
});
const diventaMac = (app) => app.evaluate(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});

async function suPaginaDErrore({ app, openTab, testServer }) {
  const page = await testServer.openReady(openTab, '<!doctype html><title>B</title><h1>pagina B</h1>');
  const urlB = page.url();
  await diventaMac(app);
  await page.evaluate(() => { window.location.href = 'http://dominio-inesistente-refuso-xyz.com/'; });
  await expect.poll(() => urlAttiva(app), { timeout: 10_000 }).toMatch(/^filo:\/\/error\//);
  await page.waitForTimeout(1_500);
  return urlB;
}

test('r1 su Mac Cmd+← dalla pagina d\'errore torna alla pagina di prima', async ({ app, openTab, testServer }) => {
  const urlB = await suPaginaDErrore({ app, openTab, testServer });
  await premi(app, 'Left', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toBe(urlB);
});

test('r1 Cmd+[ dalla pagina d\'errore torna alla pagina di prima', async ({ app, openTab, testServer }) => {
  const urlB = await suPaginaDErrore({ app, openTab, testServer });
  await premi(app, '[', ['meta']);
  await expect.poll(() => urlAttiva(app), { timeout: 8_000 }).toBe(urlB);
});
