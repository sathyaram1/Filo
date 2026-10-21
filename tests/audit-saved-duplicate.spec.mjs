// "Salva per dopo" deduplica per URL: salvare due volte la STESSA pagina non
// crea due card identiche in "Aperti per dopo" — la voce esistente viene
// aggiornata e riportata in cima.
//
// Flusso utente riprodotto:
//   1. apri una pagina, salvala con "Salva per dopo" (la tab si chiude da sola);
//   2. riapri la stessa pagina (es. il giorno dopo) e risalvala;
//   3. apri "Aperti per dopo": la pagina compare UNA SOLA volta.
//
// Pre-fix questo test falliva (comparivano 2 card): asserisce il comportamento
// corretto e diventa rosso se la dedupe regredisce.

import { test, expect } from './fixtures/electron.mjs';
import { iconaDellaBarra } from './helpers/barra.mjs';

const HOME = 'filo://home/home.html';

test('salvare due volte la stessa pagina non crea doppioni', async ({ app, openTab, testServer }) => {
  const url = testServer.html(
    `<!doctype html><html><head><title>Pagina di prova duplicati</title></head>
     <body style="padding:40px"><h1>Contenuto di prova</h1></body></html>`,
  );

  // Salva via il flusso utente REALE: icona "Salva per dopo" della barra
  // laterale. Dopo il salvataggio la tab si chiude da sola (~600ms).
  async function salvaDallaBarra() {
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
    const btn = await iconaDellaBarra(app, 'saveForLater');
    await btn.click();
    // Toast di conferma + auto-chiusura della tab (che invalida `page`:
    // l'attesa può quindi terminare con "target closed" — è il segnale
    // che il salvataggio è andato a buon fine).
    await page.waitForTimeout(1500).catch(() => {});
  }

  await salvaDallaBarra(); // 1° salvataggio
  await salvaDallaBarra(); // 2° salvataggio della STESSA pagina, riaperta

  // "Aperti per dopo": la pagina compare una sola volta.
  const home = await openTab(HOME);
  await home.waitForLoadState('domcontentloaded');
  await home.waitForTimeout(800);

  const titles = await home.locator('#grid .sn-card-title').allTextContents();
  console.log('TITLES >>>', JSON.stringify(titles));
  const dupes = titles.filter((t) => t === 'Pagina di prova duplicati').length;

  await home.screenshot({ path: 'tests/.shots/audit-saved-duplicate.png', fullPage: true }).catch(() => {});

  // Comportamento corretto: dedupe per URL → una sola card.
  expect(dupes).toBe(1);
});
