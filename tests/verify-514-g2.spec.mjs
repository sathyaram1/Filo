// Verifica avversariale #514 — "esc deve far uscire dalla modalità schermo intero".
// Provo OGNI porta da cui l'Esc può arrivare, e ogni strada per entrare.

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
      shellHeight: t.shellHeight,
      nTabs: t.tabs.length,
    };
  });
}

async function entra(app) {
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 400));
}

async function attendiUscita(app, ms = 3000) {
  const fine = Date.now() + ms;
  let s = await stato(app);
  while (Date.now() < fine && s && s.cf) {
    await new Promise((r) => setTimeout(r, 100));
    s = await stato(app);
  }
  return s;
}

test('porta 1 — Esc dalla PAGINA esterna esce dallo schermo intero', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, '<html><body><h1>ciao</h1></body></html>');
  await entra(app);
  expect((await stato(app)).cf).toBe(true);
  await page.keyboard.press('Escape');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
  expect(s.y).toBe(s.shellHeight);
});

test('porta 2 — Esc con il fuoco sulla BARRA di Filo esce dallo schermo intero', async ({ app, shell, testServer, openTab }) => {
  await testServer.openReady(openTab, '<html><body><h1>ciao</h1></body></html>');
  await entra(app);
  expect((await stato(app)).cf).toBe(true);
  await shell.keyboard.press('Escape');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
});

test('porta 3 — Esc da UNALTRA scheda esce dallo schermo intero', async ({ app, testServer, openTab }) => {
  await testServer.openReady(openTab, '<html><body><h1>uno</h1></body></html>');
  const b = await testServer.openReady(openTab, '<html><body><h1>due</h1></body></html>');
  await entra(app);
  await b.keyboard.press('Escape');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
});

test('porta 4 — Esc su una pagina INTERNA filo:// (manage) esce dallo schermo intero', async ({ app, openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await entra(app);
  await page.keyboard.press('Escape');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
});

test('porta 5 — dentro un IFRAME della pagina, Esc esce lo stesso', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><iframe id="f" srcdoc="<body><input id=i></body>" style="width:400px;height:200px"></iframe></body></html>',
  );
  await entra(app);
  const fr = page.frameLocator('#f');
  await fr.locator('#i').click();
  await page.keyboard.press('Escape');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
});

test('porta 6 — con il fuoco in un CAMPO DI TESTO della pagina, Esc esce lo stesso', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><input id="i"><script>document.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();}},true)</script></body></html>',
  );
  await page.locator('#i').click();
  await entra(app);
  await page.keyboard.press('Escape');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
});

test('porta 7 — schermo intero entrato dal SISTEMA (F11/gesto): Esc esce', async ({ app, shell, testServer, openTab }) => {
  await testServer.openReady(openTab, '<html><body><h1>ciao</h1></body></html>');
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win.setFullScreen(true);
  });
  await new Promise((r) => setTimeout(r, 800));
  const dentro = await stato(app);
  expect(dentro.cf).toBe(true); // la modalità viene adottata
  await shell.keyboard.press('Escape');
  const s = await attendiUscita(app);
  expect(s.cf).toBe(false);
});

test('porta 8 — giro doppio: entra, Esc, entra, Esc', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, '<html><body><h1>ciao</h1></body></html>');
  for (let i = 0; i < 2; i++) {
    await entra(app);
    expect((await stato(app)).cf).toBe(true);
    await page.keyboard.press('Escape');
    const s = await attendiUscita(app);
    expect(s.cf, `giro ${i + 1}`).toBe(false);
    expect(s.y, `giro ${i + 1}`).toBe(s.shellHeight);
  }
});

test('porta 9 — schermo pieno chiesto DAL SITO: Esc esce da tutto', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><button id="b" style="width:200px;height:80px">fs</button>'
    + '<script>document.getElementById("b").onclick=()=>document.documentElement.requestFullscreen()</script></body></html>',
  );
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1200));
  const dentro = await stato(app);
  expect(dentro.cf, 'il sito deve poter andare a schermo pieno').toBe(true);
  expect(dentro.pf).toBe(true);
  await page.keyboard.press('Escape');
  const s = await attendiUscita(app, 5000);
  expect(s.cf).toBe(false);
  expect(s.pf).toBe(false);
  const inPagina = await page.evaluate(() => !!document.fullscreenElement);
  expect(inPagina, 'la pagina non deve restare convinta di essere a schermo pieno').toBe(false);
});

test('porta 10 — schermo pieno dal sito + cambio scheda: Esc dalla nuova scheda esce', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><button id="b" style="width:200px;height:80px">fs</button>'
    + '<script>document.getElementById("b").onclick=()=>document.documentElement.requestFullscreen()</script></body></html>',
  );
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1200));
  expect((await stato(app)).cf).toBe(true);
  const b = await testServer.openReady(openTab, '<html><body><h1>due</h1></body></html>');
  await new Promise((r) => setTimeout(r, 500));
  await b.keyboard.press('Escape');
  const s = await attendiUscita(app, 5000);
  expect(s.cf).toBe(false);
  const inPagina = await page.evaluate(() => !!document.fullscreenElement).catch(() => null);
  expect(inPagina, 'la pagina rimasta indietro deve essere uscita dal suo schermo pieno').toBe(false);
});

test('porta 11 — schermo pieno dal sito + chiusura di quella scheda: la barra torna', async ({ app, shell, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><button id="b" style="width:200px;height:80px">fs</button>'
    + '<script>document.getElementById("b").onclick=()=>document.documentElement.requestFullscreen()</script></body></html>',
  );
  await page.locator('#b').click();
  await new Promise((r) => setTimeout(r, 1200));
  expect((await stato(app)).cf).toBe(true);
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const t = win._filoTabs;
    t.closeTab(t.activeId);
  });
  const s = await attendiUscita(app, 5000);
  expect(s.cf).toBe(false);
});

test('regressione — fuori dallo schermo intero, Esc resta della pagina', async ({ app, testServer, openTab }) => {
  const page = await testServer.openReady(
    openTab,
    '<html><body><div id="n">0</div><script>document.addEventListener("keydown",e=>{if(e.key==="Escape")document.getElementById("n").textContent="1"})</script></body></html>',
  );
  expect((await stato(app)).cf).toBe(false);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  expect(await page.locator('#n').textContent()).toBe('1');
});

test('lightbox di manage — Esc NON chiude l\'immagine aperta a schermo intero', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  // Stessa cosa che fa il clic su un'immagine allegata (openLightbox).
  await page.evaluate(() => {
    const lb = document.getElementById('mgLightbox');
    document.getElementById('mgLightboxImg').src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    lb.classList.add('open');
  });
  expect(await page.locator('#mgLightbox').isVisible()).toBe(true);
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));
  // Confronto con le pagine gemelle (dashboard, feedback) dove Esc chiude.
  const ancoraAperta = await page.locator('#mgLightbox').isVisible();
  expect(ancoraAperta, 'Esc dovrebbe chiudere il visore a schermo intero').toBe(false);
});
