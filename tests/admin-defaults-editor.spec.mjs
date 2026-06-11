// Editor admin "Modelli predefiniti": il "Prova" di una riga e il combobox
// della stringa modello.
//
// Bug coperto: il "Prova" inviava SOLO il nickname, che il main cercava nel
// registry già salvato → su una riga appena scritta falliva sempre con
// «Modello "X" non trovato». Ora la riga viene testata così com'è scritta
// (provider + stringa modello) e il campo modello è un combobox alimentato
// dal catalogo del provider.
//
// La pagina richiede un admin loggato (defaults_get altrimenti rifiuta), che
// nei test non c'è: stubbiamo chrome.runtime.sendMessage PRIMA degli script di
// pagina (init script + reload) con risposte finte, e registriamo i messaggi
// inviati per asserire COSA la pagina chiede al main.

import { test, expect } from './fixtures/electron.mjs';

const ADMIN_URL = 'filo://admin-defaults/admin-defaults.html';

async function openStubbedEditor(openTab) {
  const page = await openTab(ADMIN_URL);
  await page.addInitScript(() => {
    const fakeConfig = {
      apiKeysPresent: { openrouter: true, gemini: false, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: { esistente: { provider: 'openrouter', model: 'vendor/gia-salvato' } },
      models: {},
    };
    window.__sent = [];
    const stub = async (msg) => {
      window.__sent.push(msg);
      switch (msg.type) {
        case 'defaults_get':
          return { ok: true, config: fakeConfig };
        case 'default_models_list':
          if (msg.provider === 'openrouter') {
            return {
              ok: true,
              provider: 'openrouter',
              items: [
                { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Testo' },
                { id: 'meta-llama/llama-4-maverick:free', label: 'Testo' },
              ],
            };
          }
          return { ok: false, error: 'Chiave gemini non configurata' };
        case 'test_default_model':
          // Il main risponderebbe ok solo se riceve la stringa modello.
          if (!msg.model) return { ok: false, error: `Modello "${msg.nickname}" non trovato` };
          return { ok: true, ttftMs: 123, tokensPerSec: 45.6, provider: msg.provider, model: msg.model };
        default:
          return { ok: true };
      }
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  });
  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  return page;
}

test('Prova su una riga APPENA SCRITTA: testa provider+modello della riga, non il nickname salvato', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab);

  // Aggiungi una riga nuova e compilala (non salvata: nessun click su Salva).
  await page.click('#addModelRow');
  const row = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  await row.locator('.sn-model-nick').fill('gemma31');
  await row.locator('.sn-model-provider').selectOption('openrouter');
  await row.locator('.sn-model-id').fill('nvidia/nemotron-3-ultra-550b-a55b:free');

  await row.getByRole('button', { name: 'Prova' }).click();

  // Successo: compaiono le misure del test, NON «non trovato».
  const status = row.locator('.sn-model-row-status');
  await expect(status).toContainText('123', { timeout: 5_000 });
  await expect(status).not.toContainText('non trovato');

  // Il messaggio al main contiene provider e stringa modello della riga.
  const sent = await page.evaluate(() => window.__sent.filter((m) => m.type === 'test_default_model'));
  expect(sent.length).toBe(1);
  expect(sent[0].provider).toBe('openrouter');
  expect(sent[0].model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
});

test('la stringa modello è un combobox: datalist per provider popolata dal catalogo', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab);

  // La pagina ha chiesto i cataloghi al main…
  const asked = await page.evaluate(() => window.__sent.filter((m) => m.type === 'default_models_list').map((m) => m.provider));
  expect(asked).toContain('openrouter');

  // …e la datalist OpenRouter contiene il catalogo (non solo i valori già salvati).
  const optionIds = await page.locator('#models-list-openrouter option').evaluateAll((opts) => opts.map((o) => o.value));
  expect(optionIds).toContain('nvidia/nemotron-3-ultra-550b-a55b:free');
  expect(optionIds).toContain('meta-llama/llama-4-maverick:free');

  // Il campo della riga punta alla datalist del suo provider.
  const row = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  await expect(row.locator('.sn-model-id')).toHaveAttribute('list', 'models-list-openrouter');

  // Cambiando provider, il combobox punta all'altra lista.
  await row.locator('.sn-model-provider').selectOption('gemini');
  await expect(row.locator('.sn-model-id')).toHaveAttribute('list', 'models-list-gemini');
});

test('il main rifiuta test espliciti e catalogo ai non admin (gate reale, senza stub)', async ({ openTab }) => {
  const page = await openTab(ADMIN_URL);
  await page.waitForSelector('#title', { timeout: 8_000 });

  const testRes = await page.evaluate(() => window.filo.message({
    type: 'test_default_model', provider: 'openrouter', model: 'qualsiasi/modello',
  }));
  expect(testRes.ok).toBe(false);
  expect(String(testRes.error || '')).toMatch(/amministrator/i);

  const listRes = await page.evaluate(() => window.filo.message({ type: 'default_models_list', provider: 'openrouter' }));
  expect(listRes.ok).toBe(false);
  expect(String(listRes.error || '')).toMatch(/amministrator/i);
});
