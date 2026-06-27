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

// NB: `.sn-model-row` è usata sia dal registry editor (#modelRegistryList) sia
// dalla lista read-only dei modelli predefiniti (#defaultModelsList): scopare
// SEMPRE le query a #modelRegistryList per non prendere le righe sbagliate.
const ROW = '#modelRegistryList .sn-model-row:not(.sn-model-row-head)';

async function revealAdvanced(page) {
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });
  await page.waitForSelector(ROW, { timeout: 8_000 });
}

test('Modelli: il campo è un combobox custom legato al provider della riga', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  // Le due datalist per-provider esistono (sorgente dati del combobox); la
  // vecchia "models-list" condivisa no.
  expect(await page.locator('#models-list-gemini').count()).toBe(1);
  expect(await page.locator('#models-list-openrouter').count()).toBe(1);
  expect(await page.locator('#models-list').count()).toBe(0);

  const row = page.locator(ROW).first();
  const idInput = row.locator('.sn-model-id');

  // Niente più popup NATIVO della datalist: il campo non ha l'attributo `list`
  // (senza il fix questo è rosso). Il dropdown ora è quello custom .sn-select-*.
  await expect(idInput).not.toHaveAttribute('list', /.*/);

  // Semina la lista Gemini con un id riconoscibile (gemini non fa fetch senza
  // chiave, quindi la seed resta stabile).
  await page.evaluate(() => {
    const dl = document.getElementById('models-list-gemini');
    const o = document.createElement('option'); o.value = 'gemini-test-model';
    dl.appendChild(o);
  });

  // Provider Gemini → mettendo a fuoco il campo, il dropdown custom mostra il
  // modello Gemini seminato.
  await row.locator('.sn-model-provider').selectOption('gemini');
  await idInput.focus();
  // Scope al wrapper del campo: anche il <select> del provider è un menu custom
  // di Filo con il suo .sn-select-pop, quindi nella riga ce n'è più d'uno.
  const pop = row.locator('.sn-model-id-wrap .sn-select-pop');
  await expect(pop).toBeVisible({ timeout: 4_000 });
  await expect(pop.locator('.sn-select-option', { hasText: 'gemini-test-model' })).toBeVisible();

  // Cambiando provider su OpenRouter, il dropdown legge l'ALTRA lista: il
  // modello Gemini non compare più (la tendina segue il provider della riga).
  // Attendi la chiusura del popup (come quando l'utente clicca via dal campo)
  // così la riapertura ricostruisce la lista col nuovo provider.
  await idInput.blur();
  await expect(pop).toBeHidden();
  await row.locator('.sn-model-provider').selectOption('openrouter');
  await idInput.focus();
  await expect(pop.locator('.sn-select-option', { hasText: 'gemini-test-model' })).toHaveCount(0);
});

test('Modelli: un modello Gemini salvato compare nella tendina Gemini col nome nativo', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  // Compila la prima riga con un modello Gemini nativo e salva.
  await page.evaluate(() => {
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
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
