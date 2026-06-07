// Richiesta: "il box dove si scrive il codice del modello dovrebbe essere un
// menu a tendina con tutti i modelli di quel provider, con possibilità di
// scrivere per cercare".
//
// Implementazione: il campo "stringa modello" di ogni riga del registry è un
// combobox (input + <datalist> nativa) legato al PROVIDER della riga. Ci sono
// due liste separate (Gemini / OpenRouter); la riga punta a quella del provider
// scelto e cambiando provider la tendina cambia. La lista è seminata con i
// modelli già nel registry (nomi nativi per Gemini) e poi completata via API.
//
// Questi test asseriscono il COMPORTAMENTO, senza dipendere dalla rete:
//   1. Il campo è legato alla datalist del provider e segue il cambio provider.
//   2. Un modello Gemini salvato compare nella tendina di Gemini col NOME NATIVO
//      (niente "google/"), e non in quella di OpenRouter.
// Pre-condizione che senza il fix fallirebbe: prima esisteva una sola datalist
// condivisa "models-list" e i modelli Gemini erano elencati come "google/...".

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

async function revealAdvanced(page) {
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });
}

test('Modelli: il campo è un combobox legato al provider della riga', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  // Le due datalist per-provider esistono; la vecchia "models-list" condivisa no.
  expect(await page.locator('#models-list-gemini').count()).toBe(1);
  expect(await page.locator('#models-list-openrouter').count()).toBe(1);
  expect(await page.locator('#models-list').count()).toBe(0);

  const row = page.locator('.sn-model-row:not(.sn-model-row-head)').first();
  const idInput = row.locator('.sn-model-id');

  // Imposta il provider della riga su Gemini → il campo punta alla lista Gemini.
  await row.locator('.sn-model-provider').selectOption('gemini');
  await expect(idInput).toHaveAttribute('list', 'models-list-gemini');

  // Cambiando provider, la tendina segue.
  await row.locator('.sn-model-provider').selectOption('openrouter');
  await expect(idInput).toHaveAttribute('list', 'models-list-openrouter');
});

test('Modelli: un modello Gemini salvato compare nella tendina Gemini col nome nativo', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  // Compila la prima riga con un modello Gemini nativo e salva.
  await page.evaluate(() => {
    const row = document.querySelector('.sn-model-row:not(.sn-model-row-head)');
    row.querySelector('.sn-model-nick').value = 'miogem';
    row.querySelector('.sn-model-provider').value = 'gemini';
    row.querySelector('.sn-model-id').value = 'gemini-3.1-flash-lite';
    row.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Ricarica: il seeding della tendina parte dal registry salvato.
  await page.reload();
  await revealAdvanced(page);

  await page.waitForFunction(() => {
    const dl = document.getElementById('models-list-gemini');
    return !!dl && [...dl.options].some((o) => o.value === 'gemini-3.1-flash-lite');
  }, null, { timeout: 6_000 });

  const inGemini = await page.$$eval('#models-list-gemini option', (opts) => opts.map((o) => o.value));
  const inOr = await page.$$eval('#models-list-openrouter option', (opts) => opts.map((o) => o.value));

  expect(inGemini).toContain('gemini-3.1-flash-lite');
  // Nome NATIVO: niente prefisso google/ nella lista Gemini.
  expect(inGemini.some((v) => v.startsWith('google/'))).toBe(false);
  // E non finisce nella lista OpenRouter.
  expect(inOr).not.toContain('gemini-3.1-flash-lite');
});
