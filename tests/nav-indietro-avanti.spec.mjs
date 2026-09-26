// #685 — chi arriva da un browser qualsiasi prova Alt+← e Alt+→, e in Filo non
// succedeva niente: indietro e avanti si raggiungevano solo dal menu del tasto
// destro (dentro «Altro…») e con Ctrl+Z per il solo indietro.
//
// Qui si asserisce il SUCCESSO dal punto di vista di chi ha segnalato: premo il
// tasto e la scheda è tornata alla pagina di prima. Senza il fix ogni assert è
// rosso, perché la scheda resta dov'era.
//
// Il caso che distingue questa strada da Ctrl+Z ha un test suo: con un campo di
// testo a fuoco Ctrl+Z deve annullare, Alt+← deve navigare lo stesso — è così
// in ogni browser, ed è il motivo per cui il tasto si intercetta nel main e non
// nel content script.

import { test, expect } from './fixtures/electron.mjs';

// Il tasto si inietta sulla webContents che lo riceverebbe davvero: è lo stesso
// cammino del tasto reale (before-input-event nel main), ma deterministico in
// headless, dove la finestra non ha il fuoco del sistema. Stessa scelta di
// tests/tab-numeric-shortcuts.spec.mjs.
function premiNellaPagina(app, keyCode, modifiers = ['alt']) {
  return app.evaluate(({ BrowserWindow }, arg) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: arg.keyCode, modifiers: arg.modifiers });
  }, { keyCode, modifiers });
}

function premiSullaBarra(app, keyCode, modifiers = ['alt']) {
  return app.evaluate(({ BrowserWindow }, arg) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: arg.keyCode, modifiers: arg.modifiers });
  }, { keyCode, modifiers });
}

const PAGE_A = '<!doctype html><title>A</title><h1 id="mark-a">pagina A</h1>';
const PAGE_B = '<!doctype html><title>B</title><h1 id="mark-b">pagina B</h1>'
  + '<input id="box" type="text">';

async function navigateAndReady(page, url) {
  await page.evaluate((u) => { window.location.href = u; }, url);
  await page.waitForURL(url, { timeout: 10_000 });
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null,
    { timeout: 8_000 },
  );
}

// Porta la scheda su A e poi su B: da lì "indietro" ha una destinazione
// verificabile per URL, e "avanti" ne ha una al ritorno.
async function scheda_con_A_e_B({ openTab, testServer }) {
  const urlA = testServer.html(PAGE_A);
  const urlB = testServer.html(PAGE_B);
  const page = await testServer.openReady(openTab, PAGE_A);
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, urlB);
  await expect(page.locator('#mark-b')).toBeVisible();
  return { page, urlA, urlB };
}

test('Alt+\u2190 torna alla pagina precedente e Alt+\u2192 ci riporta avanti', async ({ app, openTab, testServer }) => {
  const { page, urlA, urlB } = await scheda_con_A_e_B({ openTab, testServer });

  await page.locator('#mark-b').click();
  await premiNellaPagina(app, 'Left');

  await page.waitForURL(urlA, { timeout: 8_000 });
  await expect(page.locator('#mark-a')).toBeVisible();

  await premiNellaPagina(app, 'Right');

  await page.waitForURL(urlB, { timeout: 8_000 });
  await expect(page.locator('#mark-b')).toBeVisible();
});

test('Alt+\u2190 naviga anche con un campo di testo a fuoco', async ({ app, openTab, testServer }) => {
  const { page, urlA } = await scheda_con_A_e_B({ openTab, testServer });

  const box = page.locator('#box');
  await box.click();
  await box.fill('sto scrivendo');
  await expect(box).toBeFocused();

  await premiNellaPagina(app, 'Left');

  // SUCCESSO = la scheda \u00e8 tornata su A. (Ctrl+Z qui annullerebbe il testo, ed
  // \u00e8 giusto cos\u00ec: sono due tasti con due significati diversi.)
  await page.waitForURL(urlA, { timeout: 8_000 });
  await expect(page.locator('#mark-a')).toBeVisible();
});

test('Alt+\u2190 vale anche col fuoco sulla barra di Filo', async ({ app, openTab, testServer }) => {
  const { page, urlA } = await scheda_con_A_e_B({ openTab, testServer });

  // Dopo un clic su una scheda il fuoco non \u00e8 pi\u00f9 nella pagina: da l\u00ec i tasti
  // della shell erano gi\u00e0 morti una volta (#404), e non devono morire di nuovo.
  await premiSullaBarra(app, 'Left');

  await page.waitForURL(urlA, { timeout: 8_000 });
  await expect(page.locator('#mark-a')).toBeVisible();
});

test('senza niente dove andare, Alt+\u2190 e Alt+\u2192 non fanno niente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE_A);
  const partenza = page.url();

  await premiNellaPagina(app, 'Left');
  await premiNellaPagina(app, 'Right');
  await page.waitForTimeout(800);

  // Nessun errore e nessun effetto: la pagina \u00e8 viva e non si \u00e8 mossa.
  expect(page.url()).toBe(partenza);
  await expect(page.locator('#mark-a')).toBeVisible();
});

test('vale anche sulle pagine di Filo, non solo sui siti', async ({ app, openTab }) => {
  // Due pagine interne diverse (e nessuna delle due è la newtab, che al boot
  // esiste già e confonderebbe la scheda su cui stiamo lavorando).
  const page = await openTab('filo://history/history.html');
  await page.waitForLoadState('domcontentloaded');
  const partenza = page.url();

  await page.evaluate(() => { window.location.href = 'filo://options/options.html'; });
  await page.waitForURL(/filo:\/\/options\//, { timeout: 10_000 });

  await premiNellaPagina(app, 'Left');

  await page.waitForURL(partenza, { timeout: 8_000 });
  expect(page.url()).toBe(partenza);
});
