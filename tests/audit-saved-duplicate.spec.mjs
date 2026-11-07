// «Salva per dopo» deduplica per indirizzo: la stessa pagina salvata due volte (riaperta il giorno dopo) è UNA card in
// «Aperti per dopo», aggiornata e riportata in cima. Si salva come l'utente, dalla barra laterale.

import { test, expect } from './fixtures/electron.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';

const HOME = 'filo://home/home.html';

test('salvare due volte la stessa pagina non crea doppioni', async ({ app, openTab, testServer }) => {
  const url = testServer.html(
    `<!doctype html><html><head><title>Pagina di prova duplicati</title></head>
     <body style="padding:40px"><h1>Contenuto di prova</h1></body></html>`,
  );

  async function salvaDallaBarra() {
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await premiNellaBarra(app, 'saveForLater');
    // Toast di conferma + auto-chiusura della tab (che invalida `page`:
    // l'attesa può quindi terminare con "target closed" — è il segnale
    // che il salvataggio è andato a buon fine).
    await page.waitForTimeout(1500).catch(() => {});
  }

  await salvaDallaBarra();
  await salvaDallaBarra();

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
