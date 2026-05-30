// Switch "Usa modelli predefiniti" nella pagina Opzioni.
//
// Requisito: di base l'utente usa modelli/chiavi predefiniti senza configurare
// nulla, quindi lo switch è ON e la config avanzata (provider/chiavi, registry,
// modelli per azione) è NASCOSTA. Disattivando lo switch la config compare e la
// scelta si persiste.
//
// Pre-condizione che senza il fix fallirebbe: prima non esisteva lo switch e le
// sezioni erano sempre visibili; ora di default sono nascoste (#sec-provider
// non è visibile) e ricompaiono solo a switch OFF.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

test('Opzioni: lo switch è ON di default e nasconde provider/registry/modelli', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

  await expect(page.locator('#useDefaultModels')).toBeChecked();
  await expect(page.locator('#sec-provider')).toBeHidden();
  await expect(page.locator('#sec-model-registry')).toBeHidden();
  await expect(page.locator('#sec-models')).toBeHidden();
});

test('Opzioni: disattivare lo switch rivela la config e la scelta si persiste', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

  await page.uncheck('#useDefaultModels');

  // Le sezioni avanzate diventano visibili immediatamente.
  await expect(page.locator('#sec-provider')).toBeVisible();
  await expect(page.locator('#sec-model-registry')).toBeVisible();
  await expect(page.locator('#sec-models')).toBeVisible();

  // L'auto-save lampeggia la conferma.
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Ricaricando, lo switch è ancora OFF e la config resta visibile.
  await page.reload();
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await expect(page.locator('#useDefaultModels')).not.toBeChecked();
  await expect(page.locator('#sec-provider')).toBeVisible();
});

test('Opzioni: riattivare lo switch ri-nasconde la config', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

  await page.uncheck('#useDefaultModels');
  await expect(page.locator('#sec-provider')).toBeVisible();

  await page.check('#useDefaultModels');
  await expect(page.locator('#sec-provider')).toBeHidden();
  await expect(page.locator('#sec-models')).toBeHidden();
});
