// AUDIT (routine, throwaway): riproduce la perdita silenziosa di una riga del
// registry modelli quando manca il nickname, con falsa conferma "salvato".
import { test, expect } from './fixtures/electron.mjs';

const OPTIONS = 'filo://options/options.html';

test('model registry: row without nickname is dropped but UI says saved', async ({ openTab }) => {
  const page = await openTab(OPTIONS);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // Mostra l'editor del registry: serve "Usa modelli predefiniti" OFF.
  await page.locator('#useDefaultModels').uncheck();
  await page.waitForTimeout(300);

  // Aggiungi una riga modello.
  await page.locator('#addModelRow').click();
  const row = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  await expect(row).toBeVisible();

  // Compila SOLO provider + id modello, lascia il nickname VUOTO.
  await row.locator('.sn-model-provider').selectOption('openrouter');
  await row.locator('.sn-model-id').fill('openai/gpt-4o-mini');
  // Blur senza toccare altri controlli: dispatch del change (bubbling su #page
  // -> save() debounced). NON cliccare la label del checkbox (lo ri-attiva).
  await row.locator('.sn-model-id').evaluate((el) => {
    el.blur();
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(900);

  // SINTOMO 1: la UI mostra la conferma "salvato" anche se la riga verrà persa.
  const hintShown = await page.locator('#savedHint').evaluate(
    (el) => el.classList.contains('sn-show'),
  );
  console.log('SAVED HINT SHOWN >>>', hintShown);

  // La riga è ancora visibile a schermo con l'id modello digitato.
  const idInDom = await row.locator('.sn-model-id').inputValue();
  console.log('ROW IN DOM, model id >>>', JSON.stringify(idInDom));

  await row.scrollIntoViewIfNeeded();
  await row.screenshot({ path: 'tests/.shots/audit-model-registry-row.png' }).catch(() => {});
  await page.screenshot({ path: 'tests/.shots/audit-model-registry-before.png', fullPage: true }).catch(() => {});

  // Ricarica la pagina: rilegge dallo storage.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(700);
  // Dopo reload useDefaultModels resta OFF (persistito), editor visibile.
  const rowsAfter = await page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').count();
  const idsAfter = await page.locator('#modelRegistryList .sn-model-id').evaluateAll(
    (els) => els.map((e) => e.value),
  );
  console.log('ROWS AFTER RELOAD >>>', rowsAfter, 'ids >>>', JSON.stringify(idsAfter));
  const lost = !idsAfter.includes('openai/gpt-4o-mini');
  console.log('MODEL LOST AFTER RELOAD >>>', lost);

  await page.screenshot({ path: 'tests/.shots/audit-model-registry-after.png', fullPage: true }).catch(() => {});

  // Asserzioni che documentano il difetto attuale (riproduzione):
  expect(hintShown).toBe(true);   // falsa conferma "salvato"
  expect(lost).toBe(true);        // riga persa silenziosamente
});
