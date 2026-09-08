// #514 — «esc deve far uscire dalla modalità schermo intero».
//
// Non è una porta sola: si entra a tutto schermo da più strade (menu del tasto
// destro, comando all'assistente, pulsante del player di un sito, schermo intero
// del sistema) e l'Esc può arrivare da più posti (la pagina, un'altra scheda, la
// barra di Filo). `tests/fullscreen-content.spec.mjs` copriva già il caso
// centrale — fuoco sulla pagina, fullscreen acceso dal menu. Qui stanno le
// strade che restavano senza uscita: chi ci finiva dentro non aveva più nessun
// tasto per tornare indietro.
//
// Senza il fix ognuno di questi test è rosso: `contentFullscreen` resta true.

import { test, expect } from './fixtures/electron.mjs';

function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    return {
      contentFullscreen: tabs.contentFullscreen,
      pageFullscreen: tabs.pageFullscreen,
      osFullscreen: win.isFullScreen(),
    };
  });
}

// Un Esc VERO. La tastiera di Playwright passa dal debugger (CDP) e non tocca
// `before-input-event`, che è il gancio del main: un test scritto con
// `keyboard.press` resterebbe verde anche togliendo il fix, perché a spegnere
// lo schermo intero sarebbe il content script della pagina. `sendInputEvent`
// entra invece nella pipeline d'input come un tasto premuto davvero.
function premiEsc(app, { dallaBarra = false } = {}) {
  return app.evaluate(({ BrowserWindow }, barra) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    const wc = barra ? win.webContents : active.view.webContents;
    try { wc.focus(); } catch (_) {}
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  }, dallaBarra);
}

// Porta la pagina a tutto schermo col suo pulsante (HTML5 requestFullscreen),
// che è la strada del player video di un sito. Serve un gesto utente.
async function fullscreenDalSito(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    return active.view.webContents.executeJavaScript(
      'document.getElementById("box").requestFullscreen().catch(()=>{}); true',
      true,
    );
  });
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(true);
}

const PAGINA = '<html><body style="margin:0"><div id="box" style="width:100px;height:100px;background:#09f"></div></body></html>';

test('Esc esce anche col fuoco sulla barra di Filo', async ({ app, openTab }) => {
  // Chi apre lo schermo intero dopo aver toccato la barra in alto (indirizzo,
  // un pulsante, il menu su Mac) lascia il fuoco lì: la barra sparisce sotto la
  // pagina ma continua a ricevere i tasti, e l'Esc non arrivava a nessuno.
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => !!(window.chrome && chrome.runtime && chrome.runtime.sendMessage), null, { timeout: 8000 });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'toggle_fullscreen' }));
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);

  await premiEsc(app, { dallaBarra: true });

  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 5000 }).toBe(false);
});

test('Esc esce da un\'altra scheda quando a tutto schermo c\'è andato un sito', async ({ app, openTab, testServer }) => {
  // A tutto schermo si cambia scheda con Alt+cifra. La deroga «l'Esc è della
  // pagina» valeva per tutte le schede: dalla nuova il tasto non arrivava alla
  // pagina del sito e non spegneva niente — trappola senza uscita.
  const sito = await testServer.openReady(openTab, PAGINA);
  expect(sito).toBeTruthy();
  await fullscreenDalSito(app);

  const altra = await openTab('filo://editor/editor.html');
  await altra.waitForLoadState('domcontentloaded').catch(() => {});
  await premiEsc(app);

  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
});

test('chiudendo la scheda che era a tutto schermo lo schermo intero si spegne', async ({ app, openTab, testServer }) => {
  // Ctrl+W funziona anche a tutto schermo: chiusa quella scheda, restava acceso
  // uno schermo intero la cui unica uscita era un Esc dentro una pagina che non
  // esisteva più.
  await testServer.openReady(openTab, PAGINA);
  await fullscreenDalSito(app);

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    tabs.closeTab(tabs.activeId);
  });

  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
  expect((await stato(app)).pageFullscreen).toBe(false);
});

test('lo schermo intero del sistema è lo schermo intero di Filo, e Esc ne esce', async ({ app, openTab }) => {
  // Se la finestra va a tutto schermo per una strada di sistema, Filo non lo
  // sapeva: schermo pieno senza modalità, quindi senza uscita con Esc.
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win.setFullScreen(true);
  });
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(true);

  await premiEsc(app);

  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
  await expect.poll(async () => (await stato(app)).osFullscreen, { timeout: 8000 }).toBe(false);
});

test('sullo schermo pieno chiesto dal sito il tasto se lo prende Filo, e la pagina decide', async ({ app, openTab, testServer }) => {
  // Fino al giro 9 questo tasto si lasciava alla pagina: usciva dal fullscreen
  // del player e il main ripristinava la barra da solo. Ma il tasto alla pagina
  // non arrivava affatto — se lo prendeva il browser per uscire — e ogni
  // riquadro che Filo aveva aperto lì sopra veniva scavalcato (#514, giro 10).
  // Adesso il tasto ce lo prendiamo noi (l'uscita va in attesa e la pagina dice
  // di chi era) e dalla barra di Filo si decide subito, perché lì la pagina non
  // lo vedrebbe mai.
  await testServer.openReady(openTab, PAGINA);
  await fullscreenDalSito(app);

  const esiti = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const dallaPagina = tabs.handleFullscreenEscape(tabs.activeId);
    return { dallaPagina, attesaArmata: !!tabs._escUscitaTimer, dallaBarra: tabs.handleFullscreenEscape(null) };
  });
  expect(esiti.dallaPagina, 'il tasto ce lo prendiamo noi, o il browser esce prima').toBe(true);
  expect(esiti.attesaArmata, 'l\'uscita va in attesa: decide la pagina').toBe(true);
  expect(esiti.dallaBarra).toBe(true);
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
});
