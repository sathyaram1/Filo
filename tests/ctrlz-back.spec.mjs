// Feedback #267 — "fai in modo che con ctrl+z si torni indietro alla pagina
// precedente". Ctrl+Z deve funzionare come la freccia "Indietro": torna alla
// pagina precedente nella cronologia della scheda.
//
// L'invariante delicata (sollevata in revisione): Ctrl+Z è l'"annulla"
// universale. Dentro un campo di testo NON deve navigare, o scrivere perderebbe
// l'undo. Quindi due asserzioni, entrambe sul COMPORTAMENTO:
//   1) fuori da un campo di testo, Ctrl+Z torna davvero alla pagina precedente;
//   2) col fuoco in un <input>, Ctrl+Z NON naviga (resta "annulla").
//
// Precondizione = stato in cui senza il fix il test fallisce: senza la
// scorciatoia, (1) resta sulla pagina B (assert rosso); senza la guardia sui
// campi editabili, (2) navigherebbe a A (assert rosso).

import { test, expect } from './fixtures/electron.mjs';

const PAGE_A = '<!doctype html><title>A</title><h1 id="mark-a">pagina A</h1>';
const PAGE_B = '<!doctype html><title>B</title><h1 id="mark-b">pagina B</h1>'
  + '<input id="box" type="text">';

// Naviga la scheda corrente verso `url` (stesso host del testServer) e aspetta
// che i content script Filo si siano rimontati sul nuovo documento.
async function navigateAndReady(page, url) {
  await page.evaluate((u) => { window.location.href = u; }, url);
  await page.waitForURL(url, { timeout: 10_000 });
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null,
    { timeout: 8_000 },
  );
}

test('Ctrl+Z torna alla pagina precedente (fuori dai campi di testo)', async ({ openTab, testServer }) => {
  const urlA = testServer.html(PAGE_A);
  const urlB = testServer.html(PAGE_B);

  // Parto su A, poi navigo su B: ora la scheda ha A nella cronologia indietro.
  const page = await testServer.openReady(openTab, PAGE_A);
  // openReady serve una pagina anonima: rinavigo su urlA "vero" così l'indietro
  // ha una destinazione stabile e verificabile per URL.
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, urlB);
  await expect(page.locator('#mark-b')).toBeVisible();

  // Fuoco fuori da qualsiasi campo: clic sul titolo (non editabile).
  await page.locator('#mark-b').click();

  // La scorciatoia richiesta.
  await page.keyboard.press('Control+z');

  // SUCCESSO = la scheda è tornata su A (la pagina precedente).
  await page.waitForURL(urlA, { timeout: 8_000 });
  await expect(page.locator('#mark-a')).toBeVisible();
});

test('Ctrl+Z resta "annulla" mentre si scrive in un campo di testo', async ({ openTab, testServer }) => {
  const urlA = testServer.html(PAGE_A);
  const urlB = testServer.html(PAGE_B);

  const page = await testServer.openReady(openTab, PAGE_A);
  await navigateAndReady(page, urlA);
  await navigateAndReady(page, urlB);

  // Fuoco DENTRO il campo di testo.
  const box = page.locator('#box');
  await box.click();
  await box.type('ciao');
  await expect(box).toBeFocused();

  await page.keyboard.press('Control+z');

  // SUCCESSO = NON ha navigato: la scheda è ancora su B e la pagina A non è
  // stata caricata. (Se la guardia sui campi editabili mancasse, qui saremmo su A.)
  await page.waitForTimeout(500);
  expect(page.url()).toBe(urlB);
  await expect(page.locator('#mark-b')).toBeVisible();
  await expect(page.locator('#mark-a')).toHaveCount(0);
});
