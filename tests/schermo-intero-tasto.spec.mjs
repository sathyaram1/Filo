// #858 — F11 (Ctrl+Cmd+F su Mac, nelle unit) mette e toglie lo schermo intero da una pagina web, da una di Filo col fuoco
// nell'indirizzo, dalla barra in alto e dalla laterale; Esc esce, il video a pieno schermo si tiene il tasto, e il nome
// del tasto si legge dove si legge la voce. Tasti da sendInputEvent: quelli di Playwright non passano da before-input-event.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi } from './helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const tabs = win._filoTabs;
    const attiva = tabs.tabs.find((t) => t.id === tabs.activeId);
    return {
      schermoIntero: tabs.contentFullscreen,
      dellaPagina: tabs.pageFullscreen,
      // A schermo intero la pagina sale fino in cima e la fila delle schede resta sotto.
      cima: attiva.view.getBounds().y,
    };
  });
}

// Il suggerimento della barra laterale è una finestra a sé, sopra la scheda (come in barra-laterale-suggerimento).
const suggerimentoVisibile = (app) => app.evaluate(async ({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w._filoTabs || w.isDestroyed() || !w.isVisible()) continue;
    try {
      const t = await w.webContents.executeJavaScript("(document.getElementById('tip') || {}).textContent || ''");
      if (t) return t;
    } catch (_) {}
  }
  return '';
});

async function entraEdEsciConF11(app, dove) {
  await premi(app, dove, 'F11');
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 5000 }).toBe(true);
  expect((await stato(app)).cima).toBe(0);
  await pausa(300);
  await premi(app, dove, 'F11');
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 5000 }).toBe(false);
  expect((await stato(app)).cima).toBeGreaterThan(0);
}

const PAGINA = '<!doctype html><title>Sito</title><body style="margin:0"><input id="campo"><div id="box" style="width:100px;height:100px;background:#09f"></div></body>';

test('F11 su una pagina web mette e toglie lo schermo intero, anche scrivendo in un campo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.focus('#campo');
  await entraEdEsciConF11(app, 'scheda');
  // Il tasto non è finito nel campo né ha cambiato pagina.
  expect(await page.inputValue('#campo')).toBe('');
});

test('F11 su una pagina di Filo col fuoco nel campo dell\'indirizzo', async ({ app, openTab }) => {
  const home = await openTab('filo://newtab/');
  await home.waitForLoadState('domcontentloaded').catch(() => {});
  const aFuoco = await home.waitForFunction(() => {
    const c = document.querySelector('textarea, input[type="text"], input:not([type]), [contenteditable="true"]');
    if (!c) return false;
    c.focus();
    return document.activeElement === c;
  }, null, { timeout: 8000 }).then(() => true, () => false);
  expect(aFuoco, 'la home non ha un campo dove scrivere l\'indirizzo').toBe(true);
  await entraEdEsciConF11(app, 'scheda');
});

test('F11 vale anche col fuoco sulla barra in alto e nella barra laterale', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await entraEdEsciConF11(app, 'shell');

  const barra = await barraPage(app);
  await comandaBarra(app, 'tasto');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  await premi(app, 'barra', 'F11');
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 5000 }).toBe(true);
});

test('F11 entra ed Esc esce, come dalla voce di menu', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await premi(app, 'scheda', 'F11');
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 5000 }).toBe(true);
  await premi(app, 'scheda', 'Escape');
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 8000 }).toBe(false);
});

test('F11 tenuto premuto entra una volta sola, e due colpi di fila tornano dove si era', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
    for (let i = 0; i < 5; i++) wc.sendInputEvent({ type: 'keyDown', keyCode: 'F11', modifiers: ['isAutoRepeat'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
  });
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 5000 }).toBe(true);
  await pausa(600);
  expect((await stato(app)).schermoIntero).toBe(true);

  await premi(app, 'scheda', 'F11');
  await premi(app, 'scheda', 'F11');
  await pausa(1200);
  expect((await stato(app)).schermoIntero).toBe(true);
});

// La strada del pulsante di un lettore video: requestFullscreen della pagina, con un gesto.
async function schermoPienoDelSito(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    return wc.executeJavaScript('document.getElementById("box").requestFullscreen().catch(()=>{}); true', true);
  });
  await expect.poll(async () => (await stato(app)).dellaPagina, { timeout: 8000 }).toBe(true);
}

test('un video a schermo pieno col suo pulsante si tiene F11, ed Esc ne esce come prima', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await schermoPienoDelSito(app);

  await premi(app, 'scheda', 'F11');
  await pausa(800);
  expect(await stato(app)).toMatchObject({ schermoIntero: true, dellaPagina: true });

  await premi(app, 'scheda', 'Escape');
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 8000 }).toBe(false);
});

test('il video si tiene F11 solo premuto su di lui: dalla barra in alto esce, e il video con lei', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await schermoPienoDelSito(app);
  await premi(app, 'shell', 'F11');
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 8000 }).toBe(false);
  expect((await stato(app)).dellaPagina).toBe(false);
});

test('il nome del tasto si legge nel suggerimento della barra laterale e fra le scorciatoie', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  const barra = await barraPage(app);
  const ico = barra.locator('#nav .ico[data-id="fullscreen"]');
  await expect(ico).toHaveAttribute('data-sugg', 'Schermo intero (F11)');
  await expect(ico).toHaveAttribute('aria-label', 'Schermo intero');
  await premi(app, 'scheda', 'F11');
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 5000 }).toBe(true);
  await expect(ico).toHaveAttribute('data-sugg', 'Esci da schermo intero (F11)');
  await premi(app, 'scheda', 'F11');
  await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 5000 }).toBe(false);

  // Passandoci sopra a barra aperta il suggerimento che compare è quello col tasto.
  await comandaBarra(app, 'clic');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  await ico.hover();
  await expect.poll(() => suggerimentoVisibile(app), { timeout: 4000 }).toBe('Schermo intero (F11)');
  await comandaBarra(app, 'chiudi');

  const altro = await openTab('filo://options/altro.html');
  await expect(altro.locator('#shortcutsList')).toContainText('F11 — Metti e togli lo schermo intero');
});
