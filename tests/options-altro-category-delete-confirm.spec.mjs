// Feedback #276: in Opzioni → Altro, il bottone "Elimina" di una categoria
// apriva la finestrella di conferma NATIVA del browser ("La pagina dice: …")
// invece del popup stilizzato di Filo (SN_CONFIRM_UI), stesso schema del bug
// già noto per "Svuota archivio" e "Cancella tutto" della Cronologia AI.
//
// ASSERISCE il successo: dopo aver seminato una categoria e cliccato "Elimina"
// compare l'host del dialogo stilizzato (.sn-confirm-host) e NON viene generato
// alcun dialogo nativo del browser. Pre-fix la pagina non caricava confirmUi.js
// e chiamava confirm() nativo → rosso (host mai visibile, dialog nativo).

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm } from './helpers/confirm.mjs';

const ALTRO_URL = 'filo://options/altro.html';

test('Opzioni → Altro: "Elimina" categoria usa il popup stilizzato, non il confirm nativo', async ({ openTab }) => {
  const page = await openTab(ALTRO_URL);
  await page.waitForLoadState('domcontentloaded');

  // Semina una categoria così che compaia una riga con il bottone "Elimina",
  // poi ricarica per far ri-renderizzare la lista.
  await page.evaluate(async () => {
    await chrome.storage.local.set({ categories: [{ id: 'test-cat-276', name: 'CategoriaTest276' }] });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Il modulo delle conferme deve essere caricato dalla pagina.
  expect(await page.evaluate(() => typeof window.SN_CONFIRM_UI)).toBe('object');

  // La riga della categoria seminata è presente.
  const row = page.locator('.sn-cat-row');
  await expect(row).toHaveCount(1);

  // Se ricomparisse il confirm nativo Playwright lo intercetterebbe qui.
  let nativeDialog = false;
  page.on('dialog', async (d) => { nativeDialog = true; await d.dismiss().catch(() => {}); });

  // Il bottone "Elimina" è l'ultimo della riga.
  await row.locator('button.sn-btn-secondary').last().click();

  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  expect(nativeDialog, 'nessun confirm nativo del browser deve comparire').toBe(false);

  // Confermando dal popup stilizzato la categoria viene davvero eliminata:
  // la feature funziona end-to-end, non si limita a mostrare il dialogo giusto.
  await clickConfirm(page, 'ok');
  await expect(page.locator('.sn-cat-row')).toHaveCount(0, { timeout: 5_000 });
  const remaining = await page.evaluate(async () => {
    const r = await chrome.storage.local.get('categories');
    return (r.categories || []).length;
  });
  expect(remaining, 'la categoria è rimossa dallo storage dopo la conferma').toBe(0);
});
