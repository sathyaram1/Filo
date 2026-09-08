// #514 (giro 5) — a schermo intero l'Esc deve chiudere PRIMA il riquadro che sta
// sopra la pagina e solo dopo uscire dalla modalità. La regola vale per i
// riquadri disegnati dai content script; i riquadri disegnati dalle PAGINE DI
// FILO (menu di ordinamento e barra di ricerca della gestione, menu del tasto
// destro sul titolo nell'editor, menu del tasto destro nella cronologia) vengono
// ancora scavalcati: il primo Esc li chiude E spegne lo schermo intero.
//
// Ogni prova ha la sua controprova fuori dallo schermo intero: lì lo stesso Esc
// chiude il riquadro, quindi il tasto è davvero suo.
import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><head><title>Sito Archiviato</title></head>
<body style="margin:0"><div style="height:600px">contenuto</div></body></html>`;

async function schermoIntero(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return !!t.contentFullscreen;
  });
}
async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}
// Il tasto vero: passa dal before-input-event del main, com'è quando lo preme
// una persona.
async function esc(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 900));
}

async function apriGestione(openTab) {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  return page;
}

test('gestione: il menu di ordinamento si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab }) => {
  const page = await apriGestione(openTab);
  const menuAperto = () => page.evaluate(() => !!document.querySelector('.mg-ctxmenu'));

  // Controprova: fuori dallo schermo intero quell'Esc chiude il menu.
  await page.click('#mgSortBtn');
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await menuAperto(), 'fuori dallo schermo intero Esc deve chiudere il menu').toBe(false);

  await page.click('#mgSortBtn');
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await entra(app);
  await esc(app);
  expect(await menuAperto(), 'il menu doveva chiudersi col primo Esc').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

test('gestione: la barra di ricerca si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab }) => {
  const page = await apriGestione(openTab);
  const ricercaAperta = () => page.evaluate(() => !document.getElementById('mgSearchBar').hidden);
  // Il fuoco fuori dal campo è il caso di chi ha appena cliccato un risultato.
  const sfuoca = () => page.evaluate(() => { try { document.activeElement.blur(); } catch (_) {} });

  await page.click('#mgSearchToggle');
  await expect.poll(ricercaAperta, { timeout: 5000 }).toBe(true);
  await sfuoca();
  await esc(app);
  expect(await ricercaAperta(), 'fuori dallo schermo intero Esc deve chiudere la ricerca').toBe(false);

  await page.click('#mgSearchToggle');
  await expect.poll(ricercaAperta, { timeout: 5000 }).toBe(true);
  await sfuoca();
  await entra(app);
  await esc(app);
  expect(await ricercaAperta(), 'la ricerca doveva chiudersi col primo Esc').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

test('editor: il menu del tasto destro sul titolo si chiude col primo Esc, lo schermo intero resta', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docbar', { timeout: 15000 });
  const menuAperto = () => page.evaluate(() => !!document.querySelector('.ed-title-ctxmenu'));

  await page.locator('#docbar').click({ button: 'right' });
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await menuAperto(), 'fuori dallo schermo intero Esc deve chiudere il menu').toBe(false);

  await page.locator('#docbar').click({ button: 'right' });
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await entra(app);
  await esc(app);
  expect(await menuAperto(), 'il menu doveva chiudersi col primo Esc').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

test('cronologia: il menu del tasto destro si chiude col primo Esc, lo schermo intero resta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await testServer.openReady(openTab, PAGE);
  const tabId = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

  const archive = await openTab('filo://archive/archive.html');
  const row = archive.locator('.arc-tab', { hasText: 'Sito Archiviato' });
  await expect(row).toBeVisible({ timeout: 10000 });
  const menuAperto = () => archive.evaluate(() => !!document.querySelector('.arc-ctxmenu'));

  await row.click({ button: 'right' });
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await esc(app);
  expect(await menuAperto(), 'fuori dallo schermo intero Esc deve chiudere il menu').toBe(false);

  await row.click({ button: 'right' });
  await expect.poll(menuAperto, { timeout: 5000 }).toBe(true);
  await entra(app);
  await esc(app);
  expect(await menuAperto(), 'il menu doveva chiudersi col primo Esc').toBe(false);
  expect(await schermoIntero(app), 'il primo Esc non doveva togliere lo schermo intero').toBe(true);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});
