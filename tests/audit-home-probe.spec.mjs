// AUDIT PROBE (non committare come feature): esercita la pagina "Aperti per dopo"
// e la home/dashboard con input limite per scovare edge case. Da rimuovere.
import { test, expect } from './fixtures/electron.mjs';

test('probe: Aperti per dopo — stato vuoto e ricerca con query senza match', async ({ openTab }) => {
  const page = await openTab('filo://home/home.html');
  await page.waitForLoadState('domcontentloaded');
  // Stato vuoto su profilo fresco
  const empty = page.locator('#empty');
  await expect(empty).toBeVisible({ timeout: 4000 });
  await page.screenshot({ path: 'tests/.shots/audit-home-empty.png' });

  // Ricerca con query che non matcha nulla: non deve crashare, deve restare vuoto
  await page.locator('#search').fill('zzz-nessun-risultato-@@@');
  await page.waitForTimeout(300);
  await expect(empty).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/audit-home-search-nomatch.png' });

  // Dump testo visibile per ispezione
  const title = await page.locator('#title').textContent();
  const emptyText = await empty.textContent();
  console.log('PROBE title=', JSON.stringify(title), 'empty=', JSON.stringify(emptyText));
});

test('probe: dashboard/newtab home carica e mostra la ricerca/messaggio', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/audit-dashboard.png' });
  const bodyState = await page.evaluate(() => document.body?.dataset?.state || '');
  console.log('PROBE dashboard state=', JSON.stringify(bodyState));
});
