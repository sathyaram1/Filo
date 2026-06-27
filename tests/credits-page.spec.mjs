// Pagina Crediti del profilo (C2): saldo + grafico a torta del consumo per tipo
// d'uso. Asserisce il SUCCESSO della feature: il saldo riflette il consumo, e la
// torta ha una fetta per ogni tipo d'uso consumato (con l'etichetta giusta).
//
// Senza il fix la pagina filo://credits/credits.html non esiste: il test fallisce
// già all'apertura. Con il fix, ma con un grafico che non legge byUsage, le
// asserzioni sulle fette diventano rosse.

import { test, expect } from './fixtures/electron.mjs';

test('la pagina Crediti mostra saldo e una fetta per tipo d\'uso', async ({ app, openTab }) => {
  // Seed di consumo nel motore crediti (processo main): due tipi d'uso distinti.
  // 0.08€ → 100 crediti (correttore), 0.16€ → 200 crediti (chat). Saldo 1000-300.
  await app.evaluate(async () => {
    const C = globalThis.SN_CREDITS;
    await C.recordConsumption({ action: 'spellcheck_word', costEur: 0.08 });
    await C.recordConsumption({ action: 'filo_chat', costEur: 0.16 });
  });

  const page = await openTab('filo://credits/credits.html');
  await page.waitForLoadState('domcontentloaded');

  // Saldo: 1000 iniziali - 300 consumati = 700.
  await expect(page.locator('#balance')).toHaveText('700');

  // Una fetta per ogni tipo d'uso consumato, con l'etichetta del gruppo.
  await expect(page.locator('#chart [data-group]')).toHaveCount(2);
  await expect(page.locator('#chart [data-group="Chat con Filo"]')).toHaveCount(1);
  await expect(page.locator('#chart [data-group="Correttore ortografico"]')).toHaveCount(1);

  // La legenda elenca gli stessi gruppi con i crediti spesi.
  await expect(page.locator('#legend li[data-group="Chat con Filo"] .sn-credits-value')).toHaveText('200');
  await expect(page.locator('#legend li[data-group="Correttore ortografico"] .sn-credits-value')).toHaveText('100');
});

test('senza consumo la pagina Crediti mostra lo stato vuoto', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#balance')).toHaveText('1.000');
  await expect(page.locator('#usageEmpty')).toBeVisible();
  await expect(page.locator('#usageSection')).toBeHidden();
});
