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

async function openStubbedEditor(openTab, overrides = {}) {
  const page = await openTab(ADMIN_URL);
  await page.addInitScript((over) => {
    const fakeConfig = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: { esistente: { provider: 'openrouter', model: 'vendor/gia-salvato', reasoning: 'medium' } },
      models: {},
      // Senza override: la lista di esclusione EFFETTIVA coincide con quella del
      // codice (nessun override remoto), che è il caso normale.
      excludedProviders: null,
      ...over,
    };
    if (fakeConfig.excludedProviders == null) {
      Object.defineProperty(fakeConfig, 'excludedProviders', {
        get: () => (window.SN_CONST && window.SN_CONST.DEFAULT_EXCLUDED_PROVIDERS) || [],
      });
    }
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
        case 'defaults_update':
          // Come il main: risponde con la config effettiva DOPO la scrittura.
          return {
            ok: true,
            config: {
              apiKeysPresent: fakeConfig.apiKeysPresent,
              safeBrowsingKeyPresent: fakeConfig.safeBrowsingKeyPresent,
              modelRegistry: (msg.config && msg.config.modelRegistry) || fakeConfig.modelRegistry,
              models: (msg.config && msg.config.models) || fakeConfig.models,
              excludedProviders: (msg.config && msg.config.excludedProviders)
                || fakeConfig.excludedProviders,
            },
          };
        default:
          return { ok: true };
      }
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  }, overrides);
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

  // Traccia visiva della run (cartella gitignorata, non è il primary signal).
  await page.screenshot({ path: 'tests/.shots/admin-defaults-editor.png', fullPage: true }).catch(() => {});
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

  // Il campo NON usa più il popup nativo della datalist (niente attributo
  // `list`): è il dropdown custom .sn-select-* coerente con Filo.
  const row = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  const idInput = row.locator('.sn-model-id');
  await expect(idInput).not.toHaveAttribute('list', /.*/);

  // Mettendo a fuoco il campo (provider OpenRouter di default), il dropdown
  // custom mostra il catalogo OpenRouter letto dalla datalist.
  await idInput.focus();
  const pop = row.locator('.sn-model-id-wrap .sn-select-pop');
  await expect(pop).toBeVisible({ timeout: 4_000 });
  await expect(pop.locator('.sn-select-option', { hasText: 'nvidia/nemotron-3-ultra-550b-a55b:free' })).toBeVisible();

  // Cambiando provider su Gemini, il dropdown legge l'altra lista: il modello
  // OpenRouter non compare più.
  await idInput.blur();
  await expect(pop).toBeHidden();
  await row.locator('.sn-model-provider').selectOption('gemini');
  await idInput.focus();
  await expect(pop.locator('.sn-select-option', { hasText: 'nvidia/nemotron-3-ultra-550b-a55b:free' })).toHaveCount(0);
});

test('livello di reasoning per-modello: mostra il valore salvato e lo ripropaga al salvataggio (#369)', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab);

  // La riga già salvata riflette il livello 'medium' della config.
  const row = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  const reason = row.locator('.sn-model-reason');
  await expect(reason).toBeVisible();
  await expect(reason).toHaveValue('medium');

  // L'owner lo alza ad "Alto" (high) e salva.
  await reason.selectOption('high');

  // Una seconda riga lasciata su Auto NON deve salvare alcun livello.
  await page.click('#addModelRow');
  const row2 = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  await row2.locator('.sn-model-nick').fill('senza');
  await row2.locator('.sn-model-provider').selectOption('openrouter');
  await row2.locator('.sn-model-id').fill('vendor/plain');
  await expect(row2.locator('.sn-model-reason')).toHaveValue('auto');

  await page.click('#saveBtn');

  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  // Il modello con livello alto lo porta nella config propagata…
  expect(upd?.config?.modelRegistry?.esistente?.reasoning).toBe('high');
  // …quello su Auto resta pulito (nessun campo reasoning nel doc condiviso).
  expect('reasoning' in (upd?.config?.modelRegistry?.senza || {})).toBe(false);

  await page.screenshot({ path: 'tests/.shots/admin-defaults-reasoning.png', fullPage: true }).catch(() => {});
});

// ── Fornitori esclusi (#518) ────────────────────────────────────────────────
// Un host che serve male (nel banco di prova rispondeva ad alcune richieste con
// la risposta di un'altra) va tolto di mezzo per TUTTI gli utenti. La lista che
// lo fa vive nella config condivisa, e la lista scritta lì sostituisce quella
// del codice: senza un posto dove scriverla, l'owner non poteva applicarla.

test('la lista dei fornitori esclusi si modifica e si salva nella config condivisa', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { excludedProviders: ['Google', 'OpenAI'] });

  // La lista effettiva arriva in pagina, una riga per fornitore.
  const rows = page.locator('#excludedList .sn-excluded-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.sn-excluded-name')).toHaveValue('Google');

  // L'owner ne aggiunge uno a mano e ne toglie un altro.
  await page.click('#addExcludedRow');
  await page.locator('#excludedList .sn-excluded-row').last().locator('.sn-excluded-name')
    .fill('Novita');
  await rows.nth(1).getByRole('button', { name: 'Rimuovi' }).click();

  await page.click('#saveBtn');

  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect(upd?.config?.excludedProviders).toEqual(['Google', 'Novita']);

  await page.screenshot({ path: 'tests/.shots/admin-defaults-excluded.png', fullPage: true }).catch(() => {});
});

test('esclusioni del codice che la lista condivisa non copre: la pagina le nomina e le rimette', async ({ openTab }) => {
  // Lista remota vecchia: non contiene Novita (né gli altri aggiunti dopo).
  const page = await openStubbedEditor(openTab, { excludedProviders: ['Google', 'OpenAI'] });

  const drift = page.locator('#excludedDrift');
  await expect(drift).toBeVisible();
  await expect(drift).toContainText('Novita');

  await drift.getByRole('button', { name: 'Rimettili nella lista' }).click();

  // Rimessi tutti: l'avviso sparisce perché non c'è più niente di scoperto.
  await expect(drift).toBeHidden();
  const names = await page.locator('#excludedList .sn-excluded-name')
    .evaluateAll((els) => els.map((e) => e.value));
  expect(names).toContain('Novita');

  // E il salvataggio propaga la lista completa, Novita compreso.
  await page.click('#saveBtn');
  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect(upd?.config?.excludedProviders).toContain('Novita');
  expect(upd?.config?.excludedProviders).toContain('Google');
});

test('un salvataggio che non tocca le esclusioni non congela la lista del codice', async ({ openTab }) => {
  // Nessun override remoto: la lista in pagina è quella del codice.
  const page = await openStubbedEditor(openTab);
  await expect(page.locator('#excludedDrift')).toBeHidden();

  await page.click('#saveBtn');

  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  // Niente campo → il doc condiviso non riceve una copia della lista di build,
  // che da lì in poi bloccherebbe ogni esclusione aggiunta con un rilascio.
  expect('excludedProviders' in (upd?.config || {})).toBe(false);
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
