// Verifica avversariale #514 — "esc deve far uscire dalla modalità schermo intero".
// Provo OGNI porta da cui l'Esc può arrivare, e ogni strada per entrare.
//
// NB: il tasto si inietta con `wc.sendInputEvent`, come fa
// tests/tab-numeric-shortcuts.spec.mjs: è lo stesso cammino del tasto reale
// (passa dal before-input-event del main), mentre la tastiera di Playwright
// entra dal lato renderer e quel cammino non lo esercita.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

async function stato(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    if (!win) return null;
    const t = win._filoTabs;
    const active = t.tabs.find((x) => x.id === t.activeId);
    let y = null;
    try { y = active ? active.view.getBounds().y : null; } catch (_) {}
    return {
      cf: !!t.contentFullscreen,
      pf: !!t.pageFullscreen,
      pfTab: t.pageFullscreenTabId,
      os: (() => { try { return win.isFullScreen(); } catch (_) { return null; } })(),
      y,
      atteso: (t.chromeCompact ? t.tabRowHeight : t.shellHeight) + t.topInset,
      nTabs: t.tabs.length,
    };
  });
}

async function entra(app) {
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 500));
}

// Esc "vero": iniettato sulla webContents indicata.
// dove = 'shell' | 'attiva' | indice della scheda
async function esc(app, dove = 'attiva') {
  await app.evaluate(async ({ BrowserWindow }, d) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = win._filoTabs;
    let wc;
    if (d === 'shell') wc = win.webContents;
    else if (d === 'attiva') wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    else wc = t.tabs[d].view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  }, dove);
}

async function attendiUscita(app, ms = 4000) {
  const fine = Date.now() + ms;
  let s = await stato(app);
  while (Date.now() < fine && s && s.cf) {
    await new Promise((r) => setTimeout(r, 100));
    s = await stato(app);
  }
  return s;
}

const SITO_FS = '<html><body><button id="b" style="width:300px;height:120px">fs</button>'
  + '<script>document.getElementById("b").onclick=()=>document.documentElement.requestFullscreen()</script></body></html>';

test('porta 1 — Esc dalla PAGINA esterna esce dallo schermo intero', async ({ app, testServer, openTab }) => {
  await testServer.openReady(openTab, '<html><body><h1>ciao</h1></body></html>');
  await entra(app);
  expect((await stato(app)).cf).toBe(true);
  await esc(app, 'attiva');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
  expect(s.y).toBe(s.atteso);
});

test('porta 2 — Esc con il fuoco sulla BARRA di Filo esce dallo schermo intero', async ({ app, testServer, openTab }) => {
  await testServer.openReady(openTab, '<html><body><h1>ciao</h1></body></html>');
  await entra(app);
  expect((await stato(app)).cf).toBe(true);
  await esc(app, 'shell');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
  expect(s.y).toBe(s.atteso);
});

test('porta 3 — Esc da UNALTRA scheda esce dallo schermo intero', async ({ app, testServer, openTab }) => {
  await testServer.openReady(openTab, '<html><body><h1>uno</h1></body></html>');
  await testServer.openReady(openTab, '<html><body><h1>due</h1></body></html>');
  await entra(app);
  await esc(app, 'attiva');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
});

test('porta 4 — Esc su una pagina INTERNA filo:// (manage) esce dallo schermo intero', async ({ app, openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await entra(app);
  await esc(app, 'attiva');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
});

test('porta 5 — con il fuoco in un IFRAME della pagina, Esc esce lo stesso', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><iframe id="f" srcdoc="<body><input id=i autofocus></body>" style="width:400px;height:200px"></iframe></body></html>',
  );
  await page.frameLocator('#f').locator('#i').click();
  await entra(app);
  await esc(app, 'attiva');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
});

test('porta 6 — con il fuoco in un CAMPO DI TESTO che si mangia Esc, si esce lo stesso', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><input id="i"><script>document.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();}},true)</script></body></html>',
  );
  await page.locator('#i').click();
  await entra(app);
  await esc(app, 'attiva');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
});

test('porta 7 — schermo intero entrato dal SISTEMA (gesto/scorciatoia): Esc esce', async ({ app, testServer, openTab }) => {
  await testServer.openReady(openTab, '<html><body><h1>ciao</h1></body></html>');
  await app.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs).setFullScreen(true);
  });
  await new Promise((r) => setTimeout(r, 1000));
  expect((await stato(app)).cf, 'la modalità va adottata').toBe(true);
  await esc(app, 'shell');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
  expect(s.os).toBe(false);
});

test('porta 8 — giro doppio: entra, Esc, entra, Esc', async ({ app, testServer, openTab }) => {
  await testServer.openReady(openTab, '<html><body><h1>ciao</h1></body></html>');
  for (let i = 0; i < 2; i++) {
    await entra(app);
    expect((await stato(app)).cf, `giro ${i + 1}`).toBe(true);
    await esc(app, 'attiva');
    const s = await attendiUscita(app);
    expect(s.cf, `giro ${i + 1}`).toBe(false);
    expect(s.y, `giro ${i + 1}`).toBe(s.atteso);
  }
});

test('porta 9 — schermo pieno chiesto DAL SITO: Esc sulla sua scheda esce da tutto', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, SITO_FS);
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1500));
  const dentro = await stato(app);
  expect(dentro.cf, 'il sito deve poter andare a schermo pieno').toBe(true);
  expect(dentro.pf).toBe(true);
  await esc(app, 'attiva');
  const s = await attendiUscita(app, 6000);
  expect(s.cf).toBe(false);
  expect(s.pf).toBe(false);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});

test('porta 10 — schermo pieno dal sito + cambio scheda: Esc dalla nuova scheda esce', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, SITO_FS);
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1500));
  expect((await stato(app)).cf).toBe(true);
  await testServer.openReady(openTab, '<html><body><h1>due</h1></body></html>');
  await new Promise((r) => setTimeout(r, 700));
  await esc(app, 'attiva');
  const s = await attendiUscita(app, 6000);
  expect(s.cf).toBe(false);
  const inPagina = await page.evaluate(() => !!document.fullscreenElement).catch(() => null);
  expect(inPagina, 'la pagina rimasta indietro deve uscire dal suo schermo pieno').toBe(false);
});

test('porta 11 — schermo pieno dal sito + chiusura di quella scheda: la barra torna', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, SITO_FS);
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1500));
  expect((await stato(app)).cf).toBe(true);
  await app.evaluate(async ({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    t.closeTab(t.activeId);
  });
  const s = await attendiUscita(app, 6000);
  expect(s.cf).toBe(false);
});

test('porta 12 — finestra in INCOGNITO: Esc esce dallo schermo intero', async ({ app }) => {
  await app.evaluate(async () => {
    require('./src/main/window').createIncognitoWindow();
  }).catch(async () => {
    await app.evaluate(async ({ BrowserWindow }) => {
      const path = require('path');
      require(path.join(process.cwd(), 'src', 'main', 'window')).createIncognitoWindow();
    });
  });
  await new Promise((r) => setTimeout(r, 2500));
  const dentro = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoIncognito);
    if (!win) return null;
    win._filoTabs.setContentFullscreen(true);
    return win._filoTabs.contentFullscreen;
  });
  expect(dentro, 'la finestra incognito deve esistere').toBe(true);
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoIncognito);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 1200));
  const dopo = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoIncognito);
    return win._filoTabs.contentFullscreen;
  });
  expect(dopo).toBe(false);
});

test('regressione — fuori dallo schermo intero, Esc resta della pagina', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><div id="n">0</div><script>document.addEventListener("keydown",e=>{if(e.key==="Escape")document.getElementById("n").textContent="1"})</script></body></html>',
  );
  expect((await stato(app)).cf).toBe(false);
  await esc(app, 'attiva');
  await new Promise((r) => setTimeout(r, 400));
  expect(await page.locator('#n').textContent()).toBe('1');
});

test('lightbox di manage — Esc non chiude l\'immagine aperta a schermo intero', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  // Stessa cosa che fa il clic su un'immagine allegata (openLightbox).
  await page.evaluate(() => {
    document.getElementById('mgLightboxImg').src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    document.getElementById('mgLightbox').classList.add('open');
  });
  expect(await page.locator('#mgLightbox').isVisible()).toBe(true);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));
  const ancoraAperta = await page.locator('#mgLightbox').isVisible();
  expect(ancoraAperta, 'Esc dovrebbe chiudere il visore a schermo intero, come nelle pagine gemelle').toBe(false);
});
