// #514 — le porte dello schermo intero che gli altri spec non coprono.
//
// Il tasto si inietta con `wc.sendInputEvent`, come tests/tab-numeric-shortcuts:
// è lo stesso cammino del tasto reale (passa dal before-input-event del main),
// mentre la tastiera di Playwright entra dal lato renderer e quel cammino non
// lo esercita.

import { test, expect } from './fixtures/electron.mjs';

const SITO_FS = '<html><body><button id="b" style="width:300px;height:120px">fs</button>'
  + '<script>document.getElementById("b").onclick=()=>document.documentElement.requestFullscreen()</script></body></html>';

async function stato(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = win._filoTabs;
    return { cf: !!t.contentFullscreen, pf: !!t.pageFullscreen, pfTab: t.pageFullscreenTabId };
  });
}

async function entra(app) {
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 500));
}

async function esc(app) {
  await app.evaluate(async ({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
}

async function attendiUscita(app, ms = 6000) {
  const fine = Date.now() + ms;
  let s = await stato(app);
  while (Date.now() < fine && s.cf) { await new Promise((r) => setTimeout(r, 100)); s = await stato(app); }
  return s;
}

test('col fuoco dentro un IFRAME della pagina, Esc esce lo stesso dallo schermo intero', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><iframe id="f" srcdoc="<body><input id=i autofocus></body>" style="width:400px;height:200px"></iframe></body></html>',
  );
  await page.frameLocator('#f').locator('#i').click();
  await entra(app);
  await esc(app);
  expect((await attendiUscita(app)).cf).toBe(false);
});

test('anche nella finestra in incognito Esc esce dallo schermo intero', async ({ app, shell }) => {
  await shell.evaluate(() => window.filoShell.openIncognito());
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const c = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito));
    if (c) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const dentro = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoIncognito);
    if (!win) return null;
    win._filoTabs.setContentFullscreen(true);
    return win._filoTabs.contentFullscreen;
  });
  expect(dentro, 'la finestra incognito deve aprirsi').toBe(true);
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoIncognito);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 1200));
  const dopo = await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find((w) => w._filoIncognito)._filoTabs.contentFullscreen);
  expect(dopo).toBe(false);
});

test('il sito va a schermo pieno e poi NAVIGA altrove: Esc funziona ancora', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, SITO_FS);
  const altra = testServer.html('<html><body><h1>altra pagina</h1></body></html>');
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1500));
  expect((await stato(app)).cf).toBe(true);
  await page.evaluate((u) => { window.location.href = u; }, altra);
  await new Promise((r) => setTimeout(r, 2500));
  await esc(app);
  expect((await attendiUscita(app)).cf, 'dopo la navigazione Esc deve uscire').toBe(false);
});

test('il sito va a schermo pieno e poi RICARICA: Esc funziona ancora', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, SITO_FS);
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1500));
  expect((await stato(app)).cf).toBe(true);
  await app.evaluate(async ({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    t.tabs.find((x) => x.id === t.activeId).view.webContents.reload();
  });
  await new Promise((r) => setTimeout(r, 2500));
  await esc(app);
  expect((await attendiUscita(app)).cf, 'dopo la ricarica Esc deve uscire').toBe(false);
});

test('schermo intero di Filo + schermo pieno del sito impilati: un Esc non lascia nulla appeso', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, SITO_FS);
  await entra(app);
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1500));
  expect((await stato(app)).pf).toBe(true);
  await esc(app);
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
  expect(s.pf).toBe(false);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});

test('fuori dallo schermo intero, Esc resta della pagina', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><div id="n">0</div><script>document.addEventListener("keydown",e=>{if(e.key==="Escape")document.getElementById("n").textContent="1"})</script></body></html>',
  );
  expect((await stato(app)).cf).toBe(false);
  await esc(app);
  await new Promise((r) => setTimeout(r, 400));
  expect(await page.locator('#n').textContent()).toBe('1');
});
