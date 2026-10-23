// Verifica #590.14 giro 1: Ctrl+Tab mandato a chi ha DAVVERO la tastiera, più volte di fila, come un utente vero.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return { ids: w._filoTabs.tabs.map((t) => t.id), attiva: w._filoTabs.activeId };
});

// Il tasto va al webContents col fuoco (quello che riceverebbe il tasto vero), non alla scheda attiva.
const premiDove = (app, modifiers) => app.evaluate(({ BrowserWindow, webContents }, mods) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w.focus();
  const col = webContents.getFocusedWebContents();
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  const wc = col || t.view.webContents;
  const chi = wc === w.webContents ? 'shell' : (w._filoTabs.tabs.find((x) => x.view.webContents === wc) || {}).id || wc.getURL();
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: mods });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: mods });
  return chi;
}, modifiers);

test('Ctrl+Tab ripetuto dalla pagina col fuoco gira tutte le schede', async ({ app, openTab, testServer }) => {
  await openTab(testServer.html('<!doctype html><title>UNO</title><input id="a">'));
  await openTab(testServer.html('<!doctype html><title>DUE</title><input id="b">'));
  const tre = await openTab(testServer.html('<!doctype html><title>TRE</title><input id="c">'));
  await tre.locator('#c').click();
  const { ids } = await schede(app);
  const visti = [];
  const chi = [];
  for (let i = 0; i < 4; i++) {
    chi.push(await premiDove(app, ['control']));
    await expect.poll(async () => (await schede(app)).attiva).toBe(ids[i % 3]);
    visti.push((await schede(app)).attiva);
  }
  console.log('fuoco:', JSON.stringify(chi), 'ids:', JSON.stringify(ids));
  expect(visti).toEqual([ids[0], ids[1], ids[2], ids[0]]);
  for (let i = 0; i < 2; i++) {
    await premiDove(app, ['control', 'shift']);
    await expect.poll(async () => (await schede(app)).attiva).toBe(ids[(3 - 1 - i) % 3]);
  }
});

test('Ctrl+Tab in fretta: cinque pressioni senza aspettare portano cinque schede avanti', async ({ app, openTab, testServer }) => {
  await openTab(testServer.html('<!doctype html><title>UNO</title><h1>1</h1>'));
  await openTab(testServer.html('<!doctype html><title>DUE</title><h1>2</h1>'));
  const tre = await openTab(testServer.html('<!doctype html><title>TRE</title><h1>3</h1>'));
  await tre.locator('h1').click();
  const { ids } = await schede(app);
  for (let i = 0; i < 5; i++) await premiDove(app, ['control']);
  await expect.poll(async () => (await schede(app)).attiva).toBe(ids[(2 + 5) % 3]);
});

test('Ctrl+Tab dalla home di Filo col fuoco nel suo campo', async ({ app, openTab, testServer }) => {
  await openTab(testServer.html('<!doctype html><title>UNO</title><h1>1</h1>'));
  const home = await openTab('filo://newtab/');
  await home.waitForLoadState('domcontentloaded');
  const campo = home.locator('textarea, input[type=text], [contenteditable=true]').first();
  await campo.click();
  await home.keyboard.type('ciao');
  const { ids, attiva } = await schede(app);
  await premiDove(app, ['control']);
  await expect.poll(async () => (await schede(app)).attiva).toBe(ids[(ids.indexOf(attiva) + 1) % ids.length]);
});

test('Ctrl+Tab con una scheda sola non scrive niente nella pagina', async ({ app, openTab, testServer }) => {
  const p = await openTab(testServer.html('<!doctype html><title>UNO</title><input id="a"><input id="b">'));
  const { ids } = await schede(app);
  await p.locator('#a').click();
  await p.keyboard.type('x');
  for (const t of ids.slice(0, -1)) await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.closeTab(id);
  }, t);
  await expect.poll(async () => (await schede(app)).ids.length).toBe(1);
  await premiDove(app, ['control']);
  await p.waitForTimeout(300);
  expect(await p.evaluate(() => document.activeElement && document.activeElement.id)).toBe('a');
});
