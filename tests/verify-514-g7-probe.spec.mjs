// Sonda (giro 7) — che cosa vede il main quando l'Esc lo preme una persona?
// Serve a capire se il tetto delle rivendicazioni, contato nel main, possa
// essere azzerato dallo stesso Esc dell'utente.
import { test } from './fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0;height:800px"><p id="t">parola</p></body></html>';

test('sonda: quali input-event arrivano al main per un Esc', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    globalThis.__sonda = [];
    wc.on('input-event', (_e, input) => {
      globalThis.__sonda.push({ type: input.type, key: input.key, code: input.code });
    });
  });

  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));
  const daPlaywright = await app.evaluate(() => {
    const v = globalThis.__sonda.slice();
    globalThis.__sonda.length = 0;
    return v;
  });
  console.log('PLAYWRIGHT press(Escape) →', JSON.stringify(daPlaywright));

  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'char', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 400));
  const conChar = await app.evaluate(() => {
    const v = globalThis.__sonda.slice();
    globalThis.__sonda.length = 0;
    return v;
  });
  console.log('sendInputEvent keyDown+char+keyUp →', JSON.stringify(conChar));

  // E la lettera 'a', per confronto: lì il char c'è di sicuro.
  await page.keyboard.press('a');
  await new Promise((r) => setTimeout(r, 400));
  const lettera = await app.evaluate(() => {
    const v = globalThis.__sonda.slice();
    globalThis.__sonda.length = 0;
    return v;
  });
  console.log('PLAYWRIGHT press(a) →', JSON.stringify(lettera));
});
