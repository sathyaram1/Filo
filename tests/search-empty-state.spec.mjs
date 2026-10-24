// Feedback #217: una ricerca senza risultati NON deve mostrare il testo di
// "archivio realmente vuoto" ("Nessuna interazione AI registrata." / "Nessuna
// scheda salvata…"), che fa credere all'utente di aver perso i propri dati.
// La ricerca del filo nella home dice «Niente nel filo per …» (dashboard-cerca.js).
//
// ASSERISCE il successo: con contenuti presenti e una query che non matcha
// nulla, lo stato vuoto dice "Nessun risultato…" (e svuotando la query i
// contenuti ricompaiono). Senza il fix il testo mostrato era quello di
// archivio/cronologia vuoti — questi assert diventano rossi.

import { test, expect } from './fixtures/electron.mjs';

test('cronologia AI: ricerca/filtro senza risultati non dicono "nessuna interazione registrata"', async ({ openTab }) => {
  const history = await openTab('filo://history/history.html');
  await history.waitForLoadState('domcontentloaded');

  // Seed di una voce di cronologia via messaggio, poi ricarica la pagina.
  await history.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.APPEND_HISTORY,
      entry: { action: 'explain', input: { selection: 'gatto' }, output: 'La spiegazione del gatto', model: 'test-model' },
    });
  });
  await history.reload();
  await history.waitForLoadState('domcontentloaded');
  await expect(history.locator('.sn-history-item')).toHaveCount(1, { timeout: 8_000 });

  const empty = history.locator('#empty');

  // Ricerca testuale senza risultati.
  await history.fill('#search', 'zzzznomatch');
  await expect(empty).toBeVisible();
  await expect(empty).toHaveText('Nessun risultato per la ricerca.');

  // Il menu "filtra per tipo" offre SOLO i nomi dei tipi presenti (le opzioni
  // sono per etichetta, #481): con la sola voce "explain" non c'è il nome di
  // "help", quindi nessun filtro può svuotare la lista col messaggio sbagliato.
  await history.fill('#search', '');
  const [spiega, aiuto] = await history.evaluate(
    () => ['explain', 'help'].map((a) => window.SN_CONST.actionLabel(a)),
  );
  const filterLabels = (await history.locator('#filter option').allTextContents()).slice(1);
  expect(filterLabels).toEqual([spiega]);
  expect(filterLabels).not.toContain(aiuto);

  // Filtrando per un tipo che ESISTE, la sua voce resta visibile (nessun falso
  // "cronologia vuota").
  await history.selectOption('#filter', { label: spiega });
  await expect(history.locator('.sn-history-item')).toHaveCount(1);
  await expect(empty).toBeHidden();

  // Rimuovendo il filtro la voce resta.
  await history.selectOption('#filter', '');
  await expect(history.locator('.sn-history-item')).toHaveCount(1);
  await expect(empty).toBeHidden();
});

test('aperti per dopo: ricerca senza risultati dice "Nessun risultato"', async ({ openTab }) => {
  const home = await openTab('filo://home/home.html');
  await home.waitForLoadState('domcontentloaded');

  // Seed di una pagina salvata, poi ricarica.
  await home.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.SAVE_LINK,
      url: 'https://example.com/articolo',
      title: 'Articolo interessante',
    });
  });
  await home.reload();
  await home.waitForLoadState('domcontentloaded');
  await expect(home.locator('.sn-card', { hasText: 'Articolo interessante' })).toBeVisible({ timeout: 8_000 });

  const empty = home.locator('#empty');
  await home.fill('#search', 'zzzznomatch');
  await expect(empty).toBeVisible();
  await expect(empty).toHaveText('Nessun risultato per la ricerca.');
  await expect(empty).not.toContainText('Nessuna scheda salvata');

  await home.fill('#search', '');
  await expect(home.locator('.sn-card', { hasText: 'Articolo interessante' })).toBeVisible();
  await expect(empty).toBeHidden();
});
