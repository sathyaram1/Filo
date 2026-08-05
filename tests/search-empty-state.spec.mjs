// Feedback #217: una ricerca senza risultati NON deve mostrare il testo di
// "archivio realmente vuoto" ("Nessuna tab archiviata, per ora." /
// "Nessuna interazione AI registrata." / "Nessuna scheda salvata…"), che fa
// credere all'utente di aver perso i propri dati.
//
// ASSERISCE il successo: con contenuti presenti e una query che non matcha
// nulla, lo stato vuoto dice "Nessun risultato…" (e svuotando la query i
// contenuti ricompaiono). Senza il fix il testo mostrato era quello di
// archivio/cronologia vuoti — questi assert diventano rossi.

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><head><title>Sito Ricerca</title></head>
<body style="margin:0"><div style="height:600px">contenuto</div></body></html>`;

test('archivio: ricerca senza risultati dice "Nessun risultato", non "archivio vuoto"', async ({ shell, openTab, testServer }) => {
  // Archivia una scheda chiudendola.
  await testServer.openReady(openTab, PAGE);
  const tabId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });
  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');
  const chip = archive.locator('.arc-tab', { hasText: 'Sito Ricerca' });
  await expect(chip).toBeVisible({ timeout: 8_000 });

  // Query che non matcha nulla → messaggio "nessun risultato", con la query.
  await archive.fill('#search', 'zzzznomatch');
  const empty = archive.locator('#empty');
  await expect(empty).toBeVisible();
  await expect(empty).toHaveText(/Nessun risultato per "zzzznomatch"/);
  await expect(empty).not.toContainText('Nessuna tab archiviata');

  // Svuotando la ricerca l'archivio ricompare: nulla è stato cancellato.
  await archive.fill('#search', '');
  await expect(chip).toBeVisible();
  await expect(empty).toBeHidden();
});

test('archivio davvero vuoto: resta il testo di default anche con una query', async ({ openTab }) => {
  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');
  const empty = archive.locator('#empty');
  await expect(empty).toBeVisible({ timeout: 8_000 });
  await expect(empty).toHaveText('Nessuna tab archiviata, per ora.');
  // Con l'archivio vuoto la query non deve trasformare il messaggio in un
  // fuorviante "nessun risultato": il problema è che non c'è nulla, punto.
  await archive.fill('#search', 'qualcosa');
  await expect(empty).toHaveText('Nessuna tab archiviata, per ora.');
});

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

  // Il menu "filtra per tipo" offre SOLO i tipi realmente presenti in
  // cronologia: con la sola voce "explain" NON esiste un'opzione "help", quindi
  // l'utente non può nemmeno filtrare fino a svuotare la lista mostrando un
  // messaggio fuorviante. È proprio questa la garanzia contro lo stato vuoto
  // ingannevole del filtro.
  await history.fill('#search', '');
  const filterValues = await history.locator('#filter option').evaluateAll(
    (opts) => opts.map((o) => o.value),
  );
  expect(filterValues).toContain('explain');
  expect(filterValues).not.toContain('help');

  // Filtrando per un tipo che ESISTE, la sua voce resta visibile (nessun falso
  // "cronologia vuota").
  await history.selectOption('#filter', 'explain');
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
