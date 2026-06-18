// AUDIT (routine, throwaway): esercita la pagina "Aperti per dopo" con dati
// limite e osserva il rendering + le interazioni (ricerca, rimuovi, apri).
import { test, expect } from './fixtures/electron.mjs';

const HOME = 'filo://home/home.html';

test('explore save-for-later with edge data', async ({ openTab }) => {
  const page = await openTab(HOME);
  await page.waitForLoadState('domcontentloaded');

  // Seed alcune pagine con dati limite via l'IPC reale.
  await page.evaluate(async () => {
    const { MSG } = window.SN_MSG;
    const pages = [
      { url: 'https://example.com/a', title: 'Pagina normale' },
      { url: 'https://example.com/b', title: '' }, // titolo vuoto
      { url: 'not a url at all', title: 'URL malformato' }, // URL non valido
      { url: 'https://example.com/c', title: 'X'.repeat(500) }, // titolo enorme
    ];
    for (const p of pages) {
      await chrome.runtime.sendMessage({ type: MSG.SAVE_PAGE, page: p });
    }
  });

  // Ricarica per rileggere dallo storage.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  const cards = page.locator('#grid .sn-card');
  const count = await cards.count();
  console.log('CARDS >>>', count);

  // Stato del back button (finding precedente: appare anche con categorize OFF).
  const backHidden = await page.locator('#back').evaluate((el) => el.hidden);
  const backVisible = await page.locator('#back').isVisible();
  console.log('BACK hidden attr >>>', backHidden, 'visible >>>', backVisible);

  // Titoli renderizzati.
  const titles = await page.locator('#grid .sn-card-title').allTextContents();
  console.log('TITLES >>>', JSON.stringify(titles));
  const domains = await page.locator('#grid .sn-card-domain span').allTextContents();
  console.log('DOMAINS >>>', JSON.stringify(domains));

  await page.screenshot({ path: 'tests/.shots/audit-saved.png', fullPage: true }).catch(() => {});

  // Prova la ricerca.
  await page.locator('#search').fill('normale');
  await page.waitForTimeout(300);
  console.log('AFTER SEARCH cards >>>', await cards.count());
  await page.locator('#search').fill('');
  await page.waitForTimeout(300);
});
