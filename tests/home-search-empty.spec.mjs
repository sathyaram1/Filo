// #220 — in «Aperti per dopo» una ricerca senza risultati mostrava il messaggio dell'archivio vuoto, come se avesse
// cancellato le pagine salvate. Deve dire «Nessun risultato per la ricerca.», e azzerata la ricerca le card tornano.

import { test, expect } from './fixtures/electron.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';

const HOME = 'filo://home/home.html';

test('ricerca senza risultati mostra "Nessun risultato", non l\'archivio vuoto', async ({ app, openTab, testServer }) => {
  const url = testServer.html(
    `<!doctype html><html><head><title>Pagina salvata di prova</title></head>
     <body style="padding:40px"><h1>Contenuto salvato</h1></body></html>`,
  );

  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await premiNellaBarra(app, 'saveForLater');
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
