// Verifica avversariale #495 — terzo giro: la lista dei risultati di ricerca
// dice quante ne ha trovate, e le schede non mentono mentre si cerca.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

const DATI = [
  { _id: 'a1', seq: 1, status: 'unlabeled', name: 'mela rossa', text: 'una mela', createdAt: '2026-01-01T00:00:00Z' },
  { _id: 'a2', seq: 2, status: 'unlabeled', name: 'pera', text: 'una pera', createdAt: '2026-01-02T00:00:00Z' },
  { _id: 'b1', seq: 3, status: 'todo', name: 'melanzana', text: 'una melanzana', createdAt: '2026-01-03T00:00:00Z' },
  { _id: 'd1', seq: 4, status: 'archived', name: 'kiwi', text: 'un kiwi', createdAt: '2026-01-04T00:00:00Z' },
];

async function boot(openTab) {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  return page;
}

test('#495 — la ricerca dice quante ne ha trovate, e zero è una risposta', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.click('#mgSearchToggle');
  // Prima di cercare: nessun numero (non c'è ancora niente da contare).
  await expect(page.locator('#mgListHead')).toHaveText('Ricerca');

  await page.fill('#mgSearchInput', 'mela');
  await page.press('#mgSearchInput', 'Enter');
  await expect(page.locator('#mgListHead')).toHaveText(/^Ricerca \(\d+\)$/, { timeout: 20000 });
  const n = await page.locator('#mgList .mg-item').count();
  await expect(page.locator('#mgListHead')).toHaveText(`Ricerca (${n})`);
  expect(n).toBeGreaterThan(0);

  // Ricerca senza risultati: "(0)", non il silenzio.
  await page.fill('#mgSearchInput', 'zzzquestononesistezzz');
  await page.press('#mgSearchInput', 'Enter');
  await expect(page.locator('#mgListHead')).toHaveText('Ricerca (0)', { timeout: 20000 });

  // Le schede continuano a dire il vero mentre si cerca.
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (2)');
  await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveText('In coda (1)');

  // Chiusa la ricerca si torna alla scheda con il suo numero e la sua lista.
  await page.press('#mgSearchInput', 'Escape');
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti (2)');
  await expect(page.locator('#mgList .mg-item')).toHaveCount(2);
});

test('#495 — campo di ricerca svuotato: il numero se ne va coi risultati', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.click('#mgSearchToggle');
  await page.fill('#mgSearchInput', 'mela');
  await page.press('#mgSearchInput', 'Enter');
  await expect(page.locator('#mgListHead')).toHaveText(/^Ricerca \(\d+\)$/, { timeout: 20000 });
  await page.fill('#mgSearchInput', '');
  await page.press('#mgSearchInput', 'Enter');
  await expect(page.locator('#mgListHead')).toHaveText('Ricerca');
});
