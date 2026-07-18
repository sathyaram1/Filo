// Feedback #220: nella pagina "Aperti per dopo", cercare una parola che non
// corrisponde a nessuna pagina salvata mostrava il messaggio di archivio vuoto
// ("Nessuna scheda salvata. Click destro su una pagina → 'Salva per dopo'."),
// come se la ricerca avesse cancellato le pagine salvate. Stessa causa già
// corretta su 'Tab archiviate' e 'Cronologia AI' (stato vuoto #empty unico
// riusato per 'davvero vuoto' e 'ricerca senza risultati').
//
// Il test asserisce il SUCCESSO del comportamento corretto:
//   - con pagine salvate + ricerca senza risultati → messaggio "Nessun
//     risultato per la ricerca." (NON il testo di archivio vuoto);
//   - la ricerca è solo un filtro: azzerando la query le card ricompaiono.
// Se qualcuno riportasse il ramo #empty al testo fisso, il primo assert
// diventerebbe rosso.

import { test, expect } from './fixtures/electron.mjs';

const HOME = 'filo://home/home.html';

test('ricerca senza risultati mostra "Nessun risultato", non l\'archivio vuoto', async ({ openTab, testServer }) => {
  const url = testServer.html(
    `<!doctype html><html><head><title>Pagina salvata di prova</title></head>
     <body style="padding:40px"><h1>Contenuto salvato</h1></body></html>`,
  );

  // Salva via il flusso utente REALE: tasto destro → "Salva per dopo".
  const page = await openTab(url);
  await page.waitForLoadState('domcontentloaded');
  await page.click('body', { button: 'right' });
  const saveBtn = page.locator('.sn-menu [data-sn-icon-id="saveForLater"]');
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();
  await page.waitForTimeout(1500).catch(() => {});

  // Apri "Aperti per dopo": la pagina salvata è presente.
  const home = await openTab(HOME);
  await home.waitForLoadState('domcontentloaded');
  await home.waitForTimeout(800);
  await expect(home.locator('#grid .sn-card-title')).toHaveCount(1);

  // Cerca una parola che non compare in nessuna pagina salvata.
  await home.fill('#search', 'zzzznomatch');
  await home.waitForTimeout(300);

  const empty = home.locator('#empty');
  await expect(empty).toBeVisible();
  // Comportamento corretto: messaggio di "nessun risultato", NON di archivio
  // vuoto (che farebbe credere all'utente di aver perso le pagine salvate).
  await expect(empty).toHaveText('Nessun risultato per la ricerca.');
  await expect(empty).not.toContainText('Salva per dopo');

  // La ricerca è solo un filtro: azzerandola la card ricompare.
  await home.fill('#search', '');
  await home.waitForTimeout(300);
  await expect(home.locator('#grid .sn-card-title')).toHaveCount(1);
  await expect(empty).toBeHidden();

  await home.screenshot({ path: 'tests/.shots/home-search-empty.png', fullPage: true }).catch(() => {});
});
