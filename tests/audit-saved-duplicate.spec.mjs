// AUDIT (routine, riproduzione): "Salva per dopo" non deduplica — salvare due
// volte la stessa pagina crea due card identiche in "Aperti per dopo".
//
// Flusso utente riprodotto:
//   1. apri una pagina, salvala con "Salva per dopo" (la tab si chiude da sola);
//   2. riapri la stessa pagina (es. il giorno dopo) e risalvala;
//   3. apri "Aperti per dopo": la stessa pagina compare DUE volte, senza alcun
//      avviso né unione delle voci.
//
// Il test asserisce lo stato ATTUALE (2 card identiche): documenta il problema
// restando verde. Il fix atteso (dedupe per URL o avviso "già salvata") lo farà
// fallire, e a quel punto va aggiornato per asserire il comportamento nuovo.

import { test, expect } from './fixtures/electron.mjs';

const HOME = 'filo://home/home.html';

test('salvare due volte la stessa pagina crea due card identiche', async ({ openTab, testServer }) => {
  const url = testServer.html(
    `<!doctype html><html><head><title>Pagina di prova duplicati</title></head>
     <body style="padding:40px"><h1>Contenuto di prova</h1></body></html>`,
  );

  // 1° salvataggio: stesso codice invocato dal bottone "Salva per dopo" del
  // menu (tasto destro). Dopo il salvataggio la tab si chiude da sola (~600ms).
  let page = await openTab(url);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.SN_ACTIONS.savePage());
  await page.waitForTimeout(1500);

  // 2° salvataggio della STESSA pagina, riaperta.
  page = await openTab(url);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => window.SN_ACTIONS.savePage());
  await page.waitForTimeout(1500);

  // "Aperti per dopo": la pagina compare due volte.
  const home = await openTab(HOME);
  await home.waitForLoadState('domcontentloaded');
  await home.waitForTimeout(800);

  const titles = await home.locator('#grid .sn-card-title').allTextContents();
  console.log('TITLES >>>', JSON.stringify(titles));
  const dupes = titles.filter((t) => t === 'Pagina di prova duplicati').length;

  await home.screenshot({ path: 'tests/.shots/audit-saved-duplicate.png', fullPage: true }).catch(() => {});

  // Stato attuale (bug): due card identiche, nessuna dedupe né avviso.
  expect(dupes).toBe(2);
});
