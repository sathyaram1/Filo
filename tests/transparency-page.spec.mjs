// Pagina di trasparenza dentro Filo (filo://transparency/).
//
// Cosa deve reggere davvero, e che gli unit test non vedono perché lì non c'è
// un DOM vero:
//   1. la pagina carica e mostra il documento, con le fonti numerate in fondo;
//   2. il documento sta nella QUERY (?doc=), non in un pannello: è ciò che rende
//      linkabile un punto preciso, che è l'uso principale di queste pagine;
//   3. le glosse del glossario compaiono in corsivo e il riquadro si apre al
//      clic (il percorso che funziona anche al tocco, dove l'hover non esiste);
//   4. i link alle fonti NON portano via la pagina interna: aprono una scheda.
//
// Tolta la feature, ognuno di questi assert diventa rosso: senza il generatore
// non c'è nessun #fonte-1, senza il runtime non c'è nessun .sn-gloss.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://transparency/transparency.html';

test('mostra il documento con le fonti numerate in fondo', async ({ openTab }) => {
  const page = await openTab(URL);

  await expect(page.locator('h1')).toHaveText('Politica sui modelli');
  await expect(page.locator('#meta')).toContainText('Ultima revisione');

  // Il corpo del documento è arrivato (non una pagina vuota).
  await expect(page.locator('#doc-body h2').first()).toBeVisible();

  // Le fonti: elenco in fondo + riferimenti in apice nel testo che ci puntano.
  const fonti = page.locator('.sn-fonti-list li');
  expect(await fonti.count()).toBeGreaterThan(10);
  const refs = page.locator('.sn-ref a');
  expect(await refs.count()).toBeGreaterThan(10);

  // Ogni riferimento del testo punta a un'ancora che esiste davvero: un numero
  // che non porta alla sua fonte è peggio che non averlo.
  const hrefs = await refs.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  for (const href of new Set(hrefs)) {
    await expect(page.locator(href)).toHaveCount(1);
  }
});

test('il documento sta nell\'indirizzo, e un\'ancora porta al punto giusto', async ({ openTab }) => {
  const page = await openTab(URL + '?doc=models#i-punti-deboli');

  await expect(page.locator('h1')).toHaveText('Politica sui modelli');
  // L'ancora esiste e la vista ci è arrivata sopra: se il salto non avvenisse
  // (contenuto iniettato dopo il load) resteremmo in cima alla pagina.
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);

  // La voce attiva della navigazione è quella del documento aperto, e le aree
  // non ancora scritte restano visibili e spente.
  await expect(page.locator('.sn-nav-item.is-active')).toHaveText('Modelli');
  expect(await page.locator('.sn-nav-item.is-soon').count()).toBe(3);
});

test('le glosse sono in corsivo e si aprono al clic (non solo al passaggio del mouse)', async ({ openTab }) => {
  const page = await openTab(URL);

  const gloss = page.locator('.sn-gloss').first();
  await expect(gloss).toBeVisible();
  await expect(gloss).toHaveCSS('font-style', 'italic');

  // Chiuso finché non lo si chiede.
  await expect(page.locator('#gloss-pop')).toBeHidden();

  await gloss.click();
  const pop = page.locator('#gloss-pop');
  await expect(pop).toBeVisible();
  const testo = (await pop.textContent()) || '';
  expect(testo.length).toBeGreaterThan(20);
  // Il testo mostrato è la glossa di QUEL termine, non di un altro.
  expect(testo).toBe(await gloss.getAttribute('data-gloss'));

  // Esc lo chiude.
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
});

test('un link a una fonte apre una scheda e non porta via la pagina interna', async ({ openTab, app }) => {
  const page = await openTab(URL);
  const before = page.url();

  const link = page.locator('.sn-fonti-list a').first();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^https?:\/\//);

  await link.click();
  // La pagina di trasparenza è ancora quella: il click è stato intercettato e
  // mandato al main come apertura di scheda.
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);

  // La scheda esterna è stata aperta dal processo main.
  const opened = await app.evaluate(async ({ webContents }) =>
    webContents.getAllWebContents().some((wc) => /^https?:/.test(wc.getURL())));
  expect(opened).toBe(true);
});
