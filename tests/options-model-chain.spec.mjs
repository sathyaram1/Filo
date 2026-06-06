// Feature: editor "a segmenti" della catena di fallback per azione, più la
// nuova pagina "Altro" (dove sono migrate blocklist e categorie).
//
// I test asseriscono il COMPORTAMENTO:
//   1. Si possono inserire più modelli per un'azione (primario + fallback) con
//      i pulsanti "+/×", e la catena viene salvata e ripristinata al reload
//      come lista ordinata (settings.models[action] = "alpha, beta").
//   2. La pagina "Altro" esiste e ospita la sezione "Domini esclusi"
//      (blocklist), che NON è più in Opzioni.
//
// Nota: usiamo la 2ª azione (EXPLAIN_DEEP) perché il suo default è un singolo
// nickname ('claude-haiku') → la catena parte da 1 segmento, comodo per testare
// l'aggiunta. (La 1ª, EXPLAIN, parte già con 2 segmenti "flash, flash-or".)

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

async function revealAdvanced(page) {
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 4_000 });
}

test('Modelli per azione: aggiungere un fallback crea una catena ordinata che persiste', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  const chain = page.locator('#modelsGrid .sn-chain').nth(1); // EXPLAIN_DEEP
  const inputs = chain.locator('.sn-chain-input');
  await expect(inputs).toHaveCount(1);
  await inputs.nth(0).fill('alpha');
  // Aggiungi un secondo segmento (fallback) e compilalo.
  await chain.locator('.sn-chain-add').click();
  await expect(inputs).toHaveCount(2);
  await inputs.nth(1).fill('beta');
  await inputs.nth(1).blur();

  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // EXPLAIN_DEEP ora ha la catena "alpha, beta" nei settings.
  const saved = await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    return s.models[window.SN_CONST.ACTIONS.EXPLAIN_DEEP];
  });
  expect(saved).toBe('alpha, beta');

  // Reload: i due segmenti riappaiono in ordine.
  await page.reload();
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 8_000 });
  const reInputs = page.locator('#modelsGrid .sn-chain').nth(1).locator('.sn-chain-input');
  await expect(reInputs).toHaveCount(2);
  await expect(reInputs.nth(0)).toHaveValue('alpha');
  await expect(reInputs.nth(1)).toHaveValue('beta');
});

test('Modelli per azione: rimuovere un segmento riduce la catena', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  const chain = page.locator('#modelsGrid .sn-chain').nth(1); // EXPLAIN_DEEP
  const inputs = chain.locator('.sn-chain-input');
  await expect(inputs).toHaveCount(1);
  await inputs.nth(0).fill('uno');
  await chain.locator('.sn-chain-add').click();
  await expect(inputs).toHaveCount(2);
  await inputs.nth(1).fill('due');

  // Rimuovi il secondo segmento → ne resta uno solo, col valore del primo.
  await chain.locator('.sn-chain-rm').nth(1).click();
  await expect(inputs).toHaveCount(1);
  await expect(inputs.nth(0)).toHaveValue('uno');
});

test('Opzioni: link "Altro" presente e blocklist NON più in pagina', async ({ openTab }) => {
  const opts = await openTab(OPTIONS_URL);
  await expect(opts.locator('#openOther')).toHaveAttribute('href', 'altro.html');
  await expect(opts.locator('#blocklist')).toHaveCount(0);
});

test('Pagina "Altro": contiene domini esclusi, categorie e il link di ritorno', async ({ openTab }) => {
  const altro = await openTab('filo://options/altro.html');
  await expect(altro.locator('#blocklist')).toBeAttached({ timeout: 8_000 });
  await expect(altro.locator('#h-categories')).toBeAttached();
  await expect(altro.locator('#backToModels')).toHaveAttribute('href', 'options.html');
});
