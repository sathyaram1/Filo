// Feature: editor "a segmenti" della catena di fallback per azione, più la
// nuova pagina "Altro" (dove sono migrate blocklist e categorie).
//
// I test asseriscono il COMPORTAMENTO:
//   1. Si possono inserire più modelli per un'azione (primario + fallback) con
//      i pulsanti "+/×", e la catena viene salvata e ripristinata al reload
//      come lista ordinata (settings.models[action] = "alpha, beta").
//   2. La pagina "Altro" esiste, è raggiungibile dal link in Opzioni, e ospita
//      la sezione "Domini esclusi" (blocklist) — che NON è più in Opzioni.

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

  const chain = page.locator('#modelsGrid .sn-chain').first();
  // Imposta il modello principale nel primo segmento.
  await chain.locator('.sn-chain-input').first().fill('alpha');
  // Aggiungi un secondo segmento (fallback) e compilalo.
  await chain.locator('.sn-chain-add').click();
  const inputs = chain.locator('.sn-chain-input');
  await expect(inputs).toHaveCount(2);
  await inputs.nth(1).fill('beta');
  await inputs.nth(1).blur();

  // Auto-save confermato.
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // La prima azione (EXPLAIN) ora ha la catena "alpha, beta" nei settings.
  const explain = await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    return s.models[window.SN_CONST.ACTIONS.EXPLAIN];
  });
  expect(explain).toBe('alpha, beta');

  // Reload: i due segmenti riappaiono in ordine.
  await page.reload();
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 8_000 });
  const reInputs = page.locator('#modelsGrid .sn-chain').first().locator('.sn-chain-input');
  await expect(reInputs).toHaveCount(2);
  await expect(reInputs.nth(0)).toHaveValue('alpha');
  await expect(reInputs.nth(1)).toHaveValue('beta');
});

test('Modelli per azione: rimuovere un segmento riduce la catena', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  const chain = page.locator('#modelsGrid .sn-chain').first();
  await chain.locator('.sn-chain-input').first().fill('uno');
  await chain.locator('.sn-chain-add').click();
  await chain.locator('.sn-chain-input').nth(1).fill('due');
  await chain.locator('.sn-chain-input').nth(1).blur();
  await expect(chain.locator('.sn-chain-input')).toHaveCount(2);

  // Rimuovi il secondo segmento.
  await chain.locator('.sn-chain-rm').nth(1).click();
  await expect(chain.locator('.sn-chain-input')).toHaveCount(1);
  await expect(chain.locator('.sn-chain-input').first()).toHaveValue('uno');
});

test('Pagina "Altro": raggiungibile da Opzioni e contiene i domini esclusi', async ({ openTab }) => {
  const opts = await openTab(OPTIONS_URL);
  // Il link "Altre opzioni" punta alla pagina altro.html.
  await expect(opts.locator('#openOther')).toHaveAttribute('href', 'altro.html');
  // In Opzioni NON c'è più la blocklist (è migrata in "Altro").
  await expect(opts.locator('#blocklist')).toHaveCount(0);

  const altro = await openTab('filo://options/altro.html');
  await expect(altro.locator('#blocklist')).toBeAttached({ timeout: 8_000 });
  await expect(altro.locator('#h-categories')).toBeAttached();
  await expect(altro.locator('#backToModels')).toHaveAttribute('href', 'options.html');
});
