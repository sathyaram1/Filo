// Verifica #685, giro 1 — indietro e avanti da OGNI strada che la segnalazione
// nomina, non solo dalla tastiera.
//
// La segnalazione chiede tre cose insieme: i tasti freccia, i due tasti
// laterali del mouse, lo scorrimento a due dita del Mac; e dice che Ctrl+Z e la
// voce nel menu del tasto destro restano. Qui si prova che ognuna porta davvero
// la scheda dov'era, e che quelle vecchie non si sono rotte per strada.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGE_A = '<!doctype html><title>A</title><h1 id="mark-a">pagina A</h1>';
const PAGE_B = '<!doctype html><title>B</title><h1 id="mark-b">pagina B</h1>'
  + '<input id="box" type="text">';

function premiNellaPagina(app, keyCode, modifiers = ['alt']) {
  return app.evaluate(({ BrowserWindow }, arg) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: arg.keyCode, modifiers: arg.modifiers });
  }, { keyCode, modifiers });
}

// I tasti laterali del mouse arrivano alla finestra come app-command: è
// esattamente quello che Electron emette quando l'utente li preme.
function tastoLateraleDelMouse(app, comando) {
  return app.evaluate(({ BrowserWindow }, arg) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.emit('app-command', { preventDefault() {} }, arg.comando);
  }, { comando });
}

function scorrimentoADueDita(app, direzione) {
  return app.evaluate(({ BrowserWindow }, arg) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.emit('swipe', { preventDefault() {} }, arg.direzione);
  }, { direzione });
}

function urlDellaSchedaAttiva(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return t.view.webContents.getURL();
  });
}

async function attendiUrl(app, atteso) {
  await expect.poll(() => urlDellaSchedaAttiva(app), { timeout: 8000 }).toBe(atteso);
}

async function navigateAndReady(page, url) {
  await page.evaluate((u) => { window.location.href = u; }, url);
  await page.waitForURL(url, { timeout: 10_000 });
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null,
    { timeout: 8_000 },
  );
}

async function scheda_con_A_e_B({ openTab, testServer }) {
  const urlA = testServer.html(PAGE_A);
  const urlB = testServer.html(PAGE_B);
  const page = await testServer.openReady(openTab, PAGE_A);
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, urlB);
  await expect(page.locator('#mark-b')).toBeVisible();
  return { page, urlA, urlB };
}

test('i due tasti laterali del mouse tornano indietro e riportano avanti', async ({ app, openTab, testServer }) => {
  const { urlA, urlB } = await scheda_con_A_e_B({ openTab, testServer });

  await tastoLateraleDelMouse(app, 'browser-backward');
  await attendiUrl(app, urlA);

  await tastoLateraleDelMouse(app, 'browser-forward');
  await attendiUrl(app, urlB);
});

test('lo scorrimento orizzontale a due dita fa le stesse due cose', async ({ app, openTab, testServer }) => {
  const { urlA, urlB } = await scheda_con_A_e_B({ openTab, testServer });

  // Si spinge la pagina a destra per tornare indietro, come in ogni browser.
  await scorrimentoADueDita(app, 'right');
  await attendiUrl(app, urlA);

  await scorrimentoADueDita(app, 'left');
  await attendiUrl(app, urlB);
});

test('i tasti del mouse non fanno danni quando non c\'e\' dove andare', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE_A);
  const prima = await urlDellaSchedaAttiva(app);

  await tastoLateraleDelMouse(app, 'browser-backward');
  await tastoLateraleDelMouse(app, 'browser-forward');
  await scorrimentoADueDita(app, 'right');
  await scorrimentoADueDita(app, 'left');
  // Anche un comando che non c'entra niente non deve smuovere nulla.
  await tastoLateraleDelMouse(app, 'browser-home');

  await page.waitForTimeout(600);
  expect(await urlDellaSchedaAttiva(app)).toBe(prima);
  await expect(page.locator('#mark-a')).toBeVisible();
});

test('anche AVANTI vale con un campo di testo a fuoco', async ({ app, openTab, testServer }) => {
  const { page, urlA, urlB } = await scheda_con_A_e_B({ openTab, testServer });

  await premiNellaPagina(app, 'Left');
  await attendiUrl(app, urlA);

  // Torniamo su B, mettiamo il cursore nel campo e chiediamo "avanti".
  await premiNellaPagina(app, 'Right');
  await attendiUrl(app, urlB);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null,
    { timeout: 8_000 },
  );
  await page.click('#box');
  await page.keyboard.type('sto scrivendo');
  await premiNellaPagina(app, 'Left');
  await attendiUrl(app, urlA);
  await premiNellaPagina(app, 'Right');
  await attendiUrl(app, urlB);
});

test('Alt+Shift+freccia resta alla selezione per parole, non naviga', async ({ app, openTab, testServer }) => {
  const { page, urlB } = await scheda_con_A_e_B({ openTab, testServer });
  await page.click('#box');
  await page.keyboard.type('una frase');

  await premiNellaPagina(app, 'Left', ['alt', 'shift']);
  await page.waitForTimeout(600);
  expect(await urlDellaSchedaAttiva(app)).toBe(urlB);
});

test('Ctrl+Z torna ancora indietro fuori dai campi di testo', async ({ app, openTab, testServer }) => {
  const { page, urlA } = await scheda_con_A_e_B({ openTab, testServer });
  await page.click('#mark-b');
  await page.keyboard.press('Control+z');
  await attendiUrl(app, urlA);
});

test('la voce del menu del tasto destro torna ancora indietro', async ({ app, openTab, testServer }) => {
  const { page, urlA } = await scheda_con_A_e_B({ openTab, testServer });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'nav_back' }));
  await attendiUrl(app, urlA);
});

test('vale anche col fuoco dentro un riquadro annidato', async ({ app, openTab, testServer }) => {
  const urlA = testServer.html(PAGE_A);
  const interna = testServer.html('<!doctype html><title>dentro</title><input id="dentro" type="text">');
  const conRiquadro = `<!doctype html><title>C</title><h1 id="mark-c">pagina C</h1><iframe id="fr" src="${interna}" width="400" height="200"></iframe>`;
  const urlC = testServer.html(conRiquadro);

  const page = await testServer.openReady(openTab, PAGE_A);
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, urlC);
  await expect(page.locator('#mark-c')).toBeVisible();

  const dentro = page.frameLocator('#fr').locator('#dentro');
  await dentro.click();
  await page.keyboard.type('scrivo qui');

  await premiNellaPagina(app, 'Left');
  await attendiUrl(app, urlA);
});

test('premuto in fretta piu\' volte, indietro si ferma sulla prima pagina', async ({ app, openTab, testServer }) => {
  const { page, urlA } = await scheda_con_A_e_B({ openTab, testServer });

  for (let i = 0; i < 6; i++) await premiNellaPagina(app, 'Left');
  await page.waitForTimeout(1200);

  const dove = await urlDellaSchedaAttiva(app);
  expect([urlA, 'filo://newtab/']).toContain(dove);
  // La scheda deve essere ancora viva e mostrare qualcosa.
  const viva = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return !!t && !t.view.webContents.isDestroyed() && !t.view.webContents.isCrashed();
  });
  expect(viva).toBe(true);
});
