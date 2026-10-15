// #834 — Le pagine web girano nella sandbox di Chromium: un buco fra la pagina e il preload troverebbe un processo chiuso,
// non Node. Qui la sandbox c'è (scheda, riquadro, finestrella di accesso, shell, fumetto) e Filo dentro lavora ancora:
// il menu del tasto destro nella pagina, in un riquadro di un altro sito e nella finestrella. Regole: src/main/preloadPacchetto.js.

import { test, expect, aspettaFinestra } from './fixtures/electron.mjs';

// Il mondo isolato in cui girano page-preload.js e i content script (lo stesso numero di src/preload/mondo-esente.js).
const MONDO_DEL_PRELOAD = 999;

const preferenze = (app, trova) => app.evaluate(({ webContents }, src) => {
  const trova = new Function('u', `return (${src})(u)`);
  const wc = webContents.getAllWebContents().find((w) => !w.isDestroyed() && trova(w.getURL()));
  if (!wc) return null;
  const p = wc.getLastWebPreferences();
  return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
}, trova.toString());

// Cosa trova chi arriva nel mondo del preload: Node no, Filo sì.
const mondoDelPreload = (app, url) => app.evaluate(({ webContents }, { u, mondo }) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
  return wc.executeJavaScriptInIsolatedWorld(mondo, [{
    code: `({ process: typeof process, require: typeof require, Buffer: typeof Buffer, menu: typeof globalThis.SN_MENU, chrome: typeof (globalThis.chrome && globalThis.chrome.storage) })`,
  }]);
}, { u: url, mondo: MONDO_DEL_PRELOAD });

const SANDBOX = { sandbox: true, contextIsolation: true, nodeIntegration: false };
const SENZA_NODE = { process: 'undefined', require: 'undefined', Buffer: 'undefined', menu: 'object', chrome: 'object' };

test('una scheda web gira in sandbox, senza Node nel mondo del preload, e il tasto destro apre il menu di Filo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<p id="t">Una pagina qualunque, con del testo da cliccare.</p>');
  const url = page.url();
  expect(await preferenze(app, (u) => u === url)).toEqual(SANDBOX);
  expect(await mondoDelPreload(app, url)).toEqual(SENZA_NODE);
  await page.locator('#t').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Invia feedback', { exact: true })).toBeVisible();
});

test('in un riquadro di un altro sito i content script si montano e il menu compare', async ({ openTab, testServer }) => {
  const dentro = testServer.html('<p id="dentro">Testo del riquadro incorporato, da un altro sito.</p>').replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<p>Fuori</p><iframe id="r" src="${dentro}" width="500" height="300"></iframe>`);
  const riquadro = page.frameLocator('#r');
  await riquadro.locator('#dentro').click({ button: 'right' });
  await expect(riquadro.locator('.sn-menu')).toBeVisible();
  const frame = page.frames().find((f) => f.url().includes('blocked.test'));
  await expect.poll(() => frame.evaluate(() => document.documentElement.dataset.filoReady)).toBe('1');
});

test('la finestrella di accesso aperta da un sito gira in sandbox, con Filo dentro', async ({ app, openTab, testServer }) => {
  const accesso = `${testServer.html('<title>Accedi</title><p id="a">Accedi al tuo account per continuare.</p>')}?client_id=a&response_type=code`;
  const page = await testServer.openReady(openTab, `<button id="b" style="width:220px;height:60px"
    onclick="window.open(${JSON.stringify(accesso).replace(/"/g, '&quot;')},'login','width=420,height=520')">Accedi</button>`);
  await page.click('#b');
  const popup = await aspettaFinestra(app, (w) => w.url() === accesso, 'la finestrella di accesso non si è aperta');
  await popup.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  expect(await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && x.webContents.getURL() === u);
    return !!w;
  }, accesso), 'è una finestra a sé, non una scheda').toBe(true);
  expect(await preferenze(app, (u) => u.includes('client_id=a'))).toEqual(SANDBOX);
  expect(await mondoDelPreload(app, accesso)).toEqual(SENZA_NODE);
  await popup.locator('#a').click({ button: 'right' });
  await expect(popup.locator('.sn-menu')).toBeVisible();
});

test('la shell, normale e in incognito, gira in sandbox e risponde', async ({ app, shell, testServer }) => {
  expect(await preferenze(app, (u) => u === 'filo://shell/shell.html')).toEqual(SANDBOX);
  const url = testServer.html('<title>Dalla barra</title><p>ok</p>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect(shell.locator('#tabs .tab', { hasText: 'Dalla barra' })).toBeVisible();
  await shell.evaluate(() => window.filoShell.openIncognito());
  const incognito = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/shell.html?incognito=1'), 'la finestra incognito non si è aperta');
  await incognito.waitForLoadState('domcontentloaded');
  expect(await preferenze(app, (u) => u.startsWith('filo://shell/shell.html?incognito=1'))).toEqual(SANDBOX);
  expect(await incognito.evaluate(() => typeof window.filoShell.tabs.open)).toBe('function');
});

test('il fumetto dei pulsanti mostra il testo e prende la sua misura senza Node', async ({ app, shell }) => {
  await shell.evaluate(() => window.filoShell.tooltipShow('Indietro di una pagina', 40, 40));
  const fumetto = await aspettaFinestra(app, (w) => w.url().startsWith('data:text/html'), 'il fumetto non è nato');
  await expect(fumetto.locator('#tip')).toHaveText('Indietro di una pagina');
  expect(await preferenze(app, (u) => u.startsWith('data:text/html') && u.includes('fumetto'))).toEqual(SANDBOX);
  expect(await fumetto.evaluate(() => ({ require: typeof require, process: typeof process }))).toEqual({ require: 'undefined', process: 'undefined' });
  // La misura torna al main: la finestra lascia i 200x30 di partenza per stare intorno alla scritta.
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('data:text/html') && x.webContents.getURL().includes('fumetto'));
    return w ? w.getBounds().height : 0;
  })).toBeLessThan(30);
});
