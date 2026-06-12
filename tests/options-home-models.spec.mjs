// I modelli della Home sono configurabili: "Home — generazione della dashboard"
// (azione filo_dashboard) e "Home — chat con Filo" (azione filo_chat) devono
// comparire nell'editor "Modelli per azione" delle Opzioni ed essere salvabili.
//
// Bug coperto: l'editor esponeva un sottoinsieme fisso di azioni che NON
// includeva le due azioni della Home → quei modelli restavano inchiodati ai
// default senza alcun modo di cambiarli. Senza il fix il primo assert (celle
// presenti) è rosso.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

// Trova la cella del grid "Modelli per azione" con l'etichetta data e ritorna
// il primo input della sua catena.
async function chainInput(page, labelText) {
  return page.locator('#modelsGrid > div')
    .filter({ has: page.locator('label', { hasText: labelText }) })
    .first()
    .locator('.sn-chain-input')
    .first();
}

test('Opzioni: i modelli della Home (dashboard e chat) sono impostabili e persistono', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

  // Rivela la config avanzata (registry + modelli per azione).
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });

  // Le due celle nuove esistono nel grid.
  const dashInput = await chainInput(page, 'Home — generazione della dashboard');
  const chatInput = await chainInput(page, 'Home — chat con Filo');
  await expect(dashInput).toBeVisible();
  await expect(chatInput).toBeVisible();

  // Imposta un nickname per ciascuna e salva (il change bubbla fino a #page).
  await dashInput.fill('miodash');
  await chatInput.fill('miachat');
  await chatInput.dispatchEvent('change');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // I valori sono persistiti nei settings sotto le chiavi azione della Home —
  // le stesse che il main legge per scegliere il modello (modelForAction).
  const models = await page.evaluate(async () => (await window.SN_STORAGE.getSettings()).models);
  expect(models.filo_dashboard).toBe('miodash');
  expect(models.filo_chat).toBe('miachat');

  // Dopo un reload l'editor rimostra i valori salvati.
  await page.reload();
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  const dashAfter = await chainInput(page, 'Home — generazione della dashboard');
  const chatAfter = await chainInput(page, 'Home — chat con Filo');
  await expect(dashAfter).toHaveValue('miodash');
  await expect(chatAfter).toHaveValue('miachat');
});
