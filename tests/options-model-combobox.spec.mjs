// Richiesta: "il box dove si scrive il codice del modello dovrebbe essere un
// menu a tendina con tutti i modelli di quel provider, con possibilità di
// scrivere per cercare".
//
// Implementazione: il campo "stringa modello" di ogni riga del registry è un
// combobox (input + <datalist>) legato al PROVIDER della riga; la lista è
// seminata con i modelli già nel registry e poi completata via API.
//
// Questi test asseriscono il COMPORTAMENTO, senza dipendere dalla rete:
//   1. Il campo è legato alla datalist del provider (niente popup nativo).
//   2. Un modello salvato compare nella tendina alla riapertura.

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

  // La datalist del provider esiste (sorgente dati del combobox); la vecchia
  // "models-list" condivisa no, e non c'è più quella di un'API diretta di Google.
  expect(await page.locator('#models-list-openrouter').count()).toBe(1);
  expect(await page.locator('#models-list').count()).toBe(0);
  expect(await page.locator('#models-list-gemini').count()).toBe(0);

  const row = page.locator(ROW).first();
  const idInput = row.locator('.sn-model-id');

  // Niente più popup NATIVO della datalist: il campo non ha l'attributo `list`
  // (senza il fix questo è rosso). Il dropdown ora è quello custom .sn-select-*.
  await expect(idInput).not.toHaveAttribute('list', /.*/);

  // Semina la lista con un id riconoscibile.
  await page.evaluate(() => {
    const dl = document.getElementById('models-list-openrouter');
    const o = document.createElement('option'); o.value = 'vendor/modello-di-prova';
    dl.appendChild(o);
  });

  // Mettendo a fuoco il campo, il dropdown custom mostra il modello seminato.
  await row.locator('.sn-model-provider').selectOption('openrouter');
  await idInput.focus();
  // Scope al wrapper del campo: anche il <select> del provider è un menu custom
  // di Filo con il suo .sn-select-pop, quindi nella riga ce n'è più d'uno.
  const pop = row.locator('.sn-model-id-wrap .sn-select-pop');
  await expect(pop).toBeVisible({ timeout: 4_000 });
  await expect(pop.locator('.sn-select-option', { hasText: 'vendor/modello-di-prova' })).toBeVisible();

});

test('Modelli: un modello salvato compare nella tendina alla riapertura', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  // Compila la prima riga con un modello e salva.
  await page.evaluate(() => {
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    row.querySelector('.sn-model-nick').value = 'miomodello';
    row.querySelector('.sn-model-provider').value = 'openrouter';
    row.querySelector('.sn-model-id').value = 'vendor/modello-salvato';
    row.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Ricarica: il seeding della tendina parte dal registry salvato.
  await page.reload();
  await revealAdvanced(page);

  await page.waitForFunction(() => {
    const dl = document.getElementById('models-list-openrouter');
    return !!dl && [...dl.options].some((o) => o.value === 'vendor/modello-salvato');
  }, null, { timeout: 6_000 });
});
