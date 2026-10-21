// Editor admin "Modelli predefiniti" (Gestione → Impostazioni predefinite, #1414): il "Prova" di una riga e il combobox
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
import { GESTIONE, ricaricaSu } from './helpers/gestione.mjs';

async function openStubbedEditor(openTab, overrides = {}) {
  const page = await openTab(GESTIONE);
  await page.addInitScript((over) => {
    // Un salvataggio vero è un giro di rete: `ritardoSalvataggioMs` lo imita,
    // per provare cosa succede a chi continua a lavorare mentre viaggia.
    const { ritardoSalvataggioMs, ...cfgOver } = over || {};
    const fakeConfig = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: { esistente: { provider: 'openrouter', model: 'vendor/gia-salvato', reasoning: 'medium' } },
      models: {},
      // Senza override: la lista di esclusione EFFETTIVA coincide con quella del
      // codice (nessun override remoto), che è il caso normale.
      excludedProviders: null,
      ...cfgOver,
    };
    // `__defaultsMinus`: la lista del codice tranne quelle voci, letta dal codice e
    // non ricopiata, così una voce di serie nuova non sposta l'avviso del test.
    if (fakeConfig.excludedProviders == null) {
      const minus = new Set(fakeConfig.__defaultsMinus || []);
      Object.defineProperty(fakeConfig, 'excludedProviders', {
        get: () => ((window.SN_CONST && window.SN_CONST.DEFAULT_EXCLUDED_PROVIDERS) || [])
          .filter((n) => !minus.has(n)),
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
        case 'default_providers_list':
          return fakeConfig.__catalogFails ? { ok: false, error: 'HTTP 500' } : {
            ok: true,
            items: [
              { name: 'Google Vertex', slug: 'google-vertex' },
              { name: 'NovitaAI', slug: 'novita' },
              { name: 'OpenAI', slug: 'openai' },
              { name: 'Together', slug: 'together' },
            ],
          };
        case 'audio_host_check': {
          // Come il main: il verdetto dipende dalla lista di esclusione che la pagina manda (#1141).
          const misto = msg.model === 'acme/misto' && Array.isArray(msg.excluded) && msg.excluded.includes('OpenAI');
          return misto ? { ok: true, verdict: 'mixed', warning: `Con «${msg.label}» la lettura non parte.` } : { ok: true, verdict: 'ok' };
        }
        case 'test_default_model':
          // Il main risponderebbe ok solo se riceve la stringa modello.
          if (!msg.model) return { ok: false, error: `Modello "${msg.nickname}" non trovato` };
          return { ok: true, ttftMs: 123, tokensPerSec: 45.6, provider: msg.provider, model: msg.model };
        case 'defaults_update':
          if (ritardoSalvataggioMs) await new Promise((r) => setTimeout(r, ritardoSalvataggioMs));
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
              excludedProviderReasons: (msg.config && msg.config.excludedProviderReasons)
                || fakeConfig.excludedProviderReasons,
            },
          };
        default:
          return { ok: true };
      }
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  }, overrides);
  await ricaricaSu(page, 'predefiniti');
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

test('voce e dettatura: l\'avviso del modello segue la lista dei fornitori esclusi che si sta modificando (#1141)', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, {
    excludedProviders: ['Google', 'OpenAI'],
    modelRegistry: { 'voce-mista': { provider: 'openrouter', model: 'acme/misto', label: 'Voce mista', inputs: ['text'], outputs: ['audio'] } },
    models: { tts: 'voce-mista' },
  });
  const idx = await page.evaluate(() => window.SN_MODEL_CHAIN.actionLabels().findIndex(([a]) => a === 'tts'));
  const avviso = page.locator('#modelsGrid > div').nth(idx).locator('.sn-chain-warn');
  await expect(avviso).toHaveText('Con «Voce mista» la lettura non parte.');
  const chiesto = await page.evaluate(() => window.__sent.filter((m) => m.type === 'audio_host_check').pop());
  expect(chiesto).toMatchObject({ action: 'tts', provider: 'openrouter', model: 'acme/misto', excluded: ['Google', 'OpenAI'] });

  // Tolto OpenAI dalla lista (non ancora salvata), l'avviso se ne va.
  await page.locator('#excludedList .sn-excluded-row').nth(1).getByRole('button', { name: 'Rimuovi' }).click();
  await expect(avviso).toBeHidden();
  const dopo = await page.evaluate(() => window.__sent.filter((m) => m.type === 'audio_host_check').pop());
  expect(dopo.excluded).toEqual(['Google']);
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

// #541: il nome si sceglie dal catalogo dello smistatore, e un refuso (che non
// escluderebbe nessuno) si vede sulla riga, con la correzione a un click.
test('il nome del fornitore escluso si sceglie dal catalogo e un refuso si segnala', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { excludedProviders: ['Google'] });
  expect(await page.evaluate(() => window.__sent.some((m) => m.type === 'default_providers_list'))).toBe(true);

  await page.click('#addExcludedRow');
  const row = page.locator('#excludedList .sn-excluded-row').last();
  const input = row.locator('.sn-excluded-name');

  // Il menu elenca i fornitori veri; sceglierne uno lo scrive e non segnala niente.
  await expect(row.locator('.sn-model-id-wrap .sn-select-pop')).toBeVisible({ timeout: 4_000 });
  await row.locator('.sn-model-id-wrap .sn-select-option', { hasText: 'Together' }).click();
  await expect(input).toHaveValue('Together');
  await expect(row.locator('.sn-model-row-msg')).toBeEmpty();

  // Un refuso: la riga lo dice e propone il nome giusto.
  await input.fill('Novtia');
  const msg = row.locator('.sn-model-row-msg');
  await expect(msg).toContainText('non esclude nessuno');
  await page.screenshot({ path: 'tests/.shots/admin-defaults-excluded-refuso.png', fullPage: true }).catch(() => {});
  await msg.getByRole('button', { name: 'Forse «NovitaAI»?' }).click();
  await expect(input).toHaveValue('NovitaAI');
  await expect(msg).toBeEmpty();

  // La forma base già in lista copre «Google Vertex» del catalogo: nessun avviso.
  await expect(page.locator('#excludedList .sn-excluded-row').first().locator('.sn-model-row-msg')).toBeEmpty();

  // Se il catalogo non arriva nessun avviso finto: il campo resta libero.
  const page2 = await openStubbedEditor(openTab, { excludedProviders: ['Novtia'], __catalogFails: true });
  await expect(page2.locator('#excludedList .sn-excluded-row .sn-model-row-msg')).toBeEmpty();
});

test('ogni fornitore escluso dice perché, e il perché si salva', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, {
    excludedProviders: ['Google', 'Novita'],
    excludedProviderReasons: [
      { name: 'Google', kind: 'producer', note: '' },
      { name: 'Novita', kind: 'unreliable', note: 'risposte scambiate' },
    ],
  });
  const rows = page.locator('#excludedList .sn-excluded-row');
  await expect(rows.nth(0).locator('.sn-excluded-kind')).toHaveValue('producer');
  await expect(rows.nth(1).locator('.sn-excluded-kind')).toHaveValue('unreliable');
  await expect(rows.nth(1).locator('.sn-excluded-note')).toHaveValue('risposte scambiate');

  // Cambiare solo il perché non riscrive la lista dei nomi.
  await rows.nth(1).locator('.sn-excluded-note').fill('30/08: risposte di altre richieste');
  await page.click('#saveBtn');
  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect('excludedProviders' in upd.config).toBe(false);
  expect(upd.config.excludedProviderReasons).toContainEqual(
    { name: 'Novita', kind: 'unreliable', note: '30/08: risposte di altre richieste' });

  // Le voci rimesse dall'avviso portano il loro perché di serie.
  const page2 = await openStubbedEditor(openTab, { excludedProviders: ['OpenAI'] });
  await page2.locator('#excludedDrift').getByRole('button', { name: 'Rimettili nella lista' }).click();
  await expect(page2.locator('#excludedDrift')).toBeHidden();
  const kinds = await page2.locator('#excludedList .sn-excluded-row').evaluateAll((rs) => rs.map((r) => [
    r.querySelector('.sn-excluded-name').value, r.querySelector('.sn-excluded-kind').value]));
  expect(kinds).toContainEqual(['Novita', 'unreliable']);
  expect(kinds).toContainEqual(['Google', 'producer']);

  for (const theme of ['light', 'dark']) {
    await page2.evaluate((t) => window.SN_PAGE_BOOTSTRAP.applyTheme(t), theme);
    await page2.locator('#sec-excluded').screenshot({ path: `tests/.shots/admin-defaults-excluded-${theme}.png` }).catch(() => {});
  }
});

// #541 giro 1: il nome che il menu scrive per Novita è quello del catalogo; la
// pagina deve riconoscerlo come la voce del codice, e dargli il suo motivo.
test('scelto dal catalogo il nome di una voce del codice, l\'avviso lo conta e il motivo segue', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { __defaultsMinus: ['Novita'] });
  await expect(page.locator('#excludedDriftText')).toContainText('Novita');
  await page.click('#addExcludedRow');
  const row = page.locator('#excludedList .sn-excluded-row').last();
  await row.locator('.sn-excluded-name').fill('Novtia');
  await row.locator('.sn-excluded-guess').click();
  await expect(row.locator('.sn-excluded-name')).toHaveValue('NovitaAI');
  await expect(page.locator('#excludedDrift')).toBeHidden();
  await expect(row.locator('.sn-excluded-kind')).toHaveValue('unreliable');
  await expect(row.locator('.sn-excluded-note')).not.toHaveValue('');

  // Dal menu, stessa cosa.
  await row.locator('.sn-excluded-name').fill('');
  await expect(page.locator('#excludedDrift')).toBeVisible();
  await row.locator('.sn-model-id-wrap .sn-select-option', { hasText: 'NovitaAI' }).click();
  await expect(page.locator('#excludedDrift')).toBeHidden();
});

// #1004.2: il blur chiude il menu in ritardo; un campo tornato a fuoco nel frattempo
// deve tenerlo aperto, e un campo già a fuoco lo riapre al clic.
test('il menu del catalogo resta sceglibile se il campo torna a fuoco subito, e si riapre al clic', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab);
  await page.click('#addExcludedRow');
  const row = page.locator('#excludedList .sn-excluded-row').last();
  const name = row.locator('.sn-excluded-name');
  const pop = row.locator('.sn-model-id-wrap .sn-select-pop');
  await name.click();
  await expect(pop).toBeVisible();

  await name.evaluate((el) => { el.blur(); el.focus(); });
  await page.waitForTimeout(300);
  await expect(pop).toBeVisible();
  await pop.locator('.sn-select-option', { hasText: 'NovitaAI' }).click();
  await expect(name).toHaveValue('NovitaAI');
  await expect(row.locator('.sn-excluded-kind')).toHaveValue('unreliable');
  await expect(pop).toBeHidden();

  // Dopo la scelta il campo resta a fuoco: cambiarla passa di nuovo dal menu.
  await expect(name).toBeFocused();
  await name.click();
  await expect(pop).toBeVisible();
  await pop.locator('.sn-select-option', { hasText: 'Google Vertex' }).click();
  await expect(name).toHaveValue('Google Vertex');
});

test('il main rifiuta test espliciti e catalogo ai non admin (gate reale, senza stub)', async ({ openTab }) => {
  const page = await openTab(GESTIONE);
  await page.waitForSelector('#panel-predefiniti', { state: 'attached', timeout: 8_000 });

  const testRes = await page.evaluate(() => window.filo.message({
    type: 'test_default_model', provider: 'openrouter', model: 'qualsiasi/modello',
  }));
  expect(testRes.ok).toBe(false);
  expect(String(testRes.error || '')).toMatch(/amministrator/i);

  const listRes = await page.evaluate(() => window.filo.message({ type: 'default_models_list', provider: 'openrouter' }));
  expect(listRes.ok).toBe(false);
  expect(String(listRes.error || '')).toMatch(/amministrator/i);

  const provRes = await page.evaluate(() => window.filo.message({ type: 'default_providers_list' }));
  expect(provRes.ok).toBe(false);
  expect(String(provRes.error || '')).toMatch(/amministrator/i);
});

// #465: la ricerca fra i feedback si imposta in Gestione, ma finché lì non la si salva la
// sua catena vive qui. Salvare la griglia non deve cancellare le funzioni che non mostra.
test('salvare i modelli predefiniti tiene la catena delle funzioni spostate in Gestione', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, {
    models: { manage_search: 'esistente', explain: 'esistente' },
  });
  await expect(page.locator('#modelsGrid label', { hasText: /ricerca fra i feedback/i })).toHaveCount(0);

  await page.click('#saveBtn');
  await expect.poll(() => page.evaluate(() => window.__sent.some((m) => m.type === 'defaults_update'))).toBe(true);
  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect(upd.config.models.manage_search).toBe('esistente');
  expect(upd.config.models.explain).toBe('esistente');

  // Anche al secondo salvataggio, dopo che la pagina ha riletto la risposta.
  await page.click('#saveBtn');
  await expect.poll(() => page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').length)).toBe(2);
  const upd2 = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect(upd2.config.models.manage_search).toBe('esistente');
});

// #833 — I modelli predefiniti veri stanno nella config condivisa: una scelta dell'owner può fermare una funzione a
// chi ha acceso «Solo modelli a pesi aperti». La pagina lo dice prima del salvataggio, senza impedirlo, e chiama le
// funzioni coi nomi della griglia, che sono quelli delle Opzioni.
const PESI_APERTI = {
  modelRegistry: {
    chiuso: { provider: 'openrouter', model: 'openai/gpt-5.2' },
    aperto: { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
    claude: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' },
    deepseek: { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
  },
  models: { explain: 'chiuso', filo_chat: 'claude', translate_selection: 'aperto' },
};

function cellaDi(page, action) {
  return page.evaluate((a) => window.SN_MODEL_CHAIN.actionLabels().findIndex(([x]) => x === a), action)
    .then((idx) => page.locator('#modelsGrid > div').nth(idx));
}

test('pesi aperti: una funzione col solo modello chiuso senza sostituto è fra quelle che si fermano, e ne esce con un modello aperto in coda (#833)', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, PESI_APERTI);
  const [spiega, chat] = await page.evaluate(() => [window.SN_I18N.t('options_action_explain'), window.SN_I18N.t('options_action_filo_chat')]);

  const box = page.locator('#openWeightsImpact');
  const ferme = box.locator('.sn-ow-stop');
  await expect(box).toBeVisible();
  await expect(box.locator('.sn-info-box-title')).toHaveText('Per chi accende «Solo modelli a pesi aperti»');
  // Lo stesso nome della griglia, che è quello delle Opzioni; la chat ha un sostituto e non si ferma.
  const cella = await cellaDi(page, 'explain');
  await expect(cella.locator('label')).toHaveText(spiega);
  await expect(ferme).toHaveText(`Si fermano (nessun equivalente a pesi aperti): ${spiega}`);
  await expect(box).toContainText(`Passano a deepseek: ${chat}`);
  await page.screenshot({ path: 'tests/.shots/admin-defaults-open-weights-ferme.png', fullPage: true }).catch(() => {});

  // In coda alla catena un modello a pesi aperti: con l'interruttore acceso la funzione gira su quello.
  await cella.locator('.sn-chain-add').click();
  await expect(cella.locator('.sn-chain-input')).toHaveCount(2);
  await cella.locator('.sn-chain-input').nth(1).click();
  await cella.locator('.sn-chain-pop .sn-select-option', { hasText: 'aperto' }).click();
  await expect(cella.locator('.sn-chain-input').nth(1)).toHaveValue('aperto');
  await expect(ferme).toHaveCount(0);
  await expect(box).toContainText(`Passano a aperto: ${spiega}`);
  await expect(box).toContainText('Nessuna funzione si ferma.');

  // È un avviso: niente è partito prima del clic, e il salvataggio resta libero.
  expect(await page.evaluate(() => window.__sent.some((m) => m.type === 'defaults_update'))).toBe(false);
  await page.click('#saveBtn');
  await expect.poll(() => page.evaluate(() => window.__sent.some((m) => m.type === 'defaults_update'))).toBe(true);
  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect(upd.config.models.explain).toBe('chiuso, aperto');
});

test('pesi aperti: tolto dal registro il sostituto aperto, la funzione che contava su di lui passa fra le ferme (#833)', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, PESI_APERTI);
  const chat = await page.evaluate(() => window.SN_I18N.t('options_action_filo_chat'));
  const ferme = page.locator('#openWeightsImpact .sn-ow-stop');
  await expect(ferme).not.toContainText(chat);

  const righe = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
  const idx = await righe.evaluateAll((els) => els.findIndex((r) => r.querySelector('.sn-model-nick').value === 'deepseek'));
  expect(idx).toBeGreaterThanOrEqual(0);
  await righe.nth(idx).getByRole('button', { name: 'Rimuovi', exact: true }).click();
  await expect(ferme).toContainText(chat);
  await expect(page.locator('#openWeightsImpact')).not.toContainText('Passano a deepseek');
});

test('pesi aperti: con tutte le funzioni già su modelli aperti la pagina lo dice in una riga, e cambiando un modello torna l\'elenco (#833)', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { ...PESI_APERTI, models: { explain: 'aperto', translate_selection: 'aperto, deepseek' } });
  const box = page.locator('#openWeightsImpact');
  await expect(box).toHaveText('Con «Solo modelli a pesi aperti» acceso non cambia niente. Tutte le funzioni partono già da modelli a pesi aperti.');
  await expect(box).not.toHaveClass(/sn-info-box/);
  await page.screenshot({ path: 'tests/.shots/admin-defaults-open-weights-tutte.png', fullPage: true }).catch(() => {});

  // Sostituito il modello aperto con uno chiuso (scelto dal menu, come farebbe l'owner), l'avviso si accende.
  const cella = await cellaDi(page, 'explain');
  const campo = cella.locator('.sn-chain-input').first();
  await campo.click();
  await campo.fill('');
  await cella.locator('.sn-chain-pop .sn-select-option', { hasText: 'chiuso' }).click();
  await expect(campo).toHaveValue('chiuso');
  const spiega = await page.evaluate(() => window.SN_I18N.t('options_action_explain'));
  await expect(box.locator('.sn-ow-stop')).toHaveText(`Si fermano (nessun equivalente a pesi aperti): ${spiega}`);
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme('dark'));
  await page.screenshot({ path: 'tests/.shots/admin-defaults-open-weights-scuro.png', fullPage: true }).catch(() => {});
});

test('pesi aperti: senza nessun modello scelto la riga non compare (#833)', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab);
  await expect(page.locator('#modelsGrid .sn-chain').first()).toBeVisible();
  await expect(page.locator('#openWeightsImpact')).toBeHidden();
});

test('la conferma del salvataggio non sopravvive alla modifica dopo: lo schermo dice che non è ancora propagato', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab);
  const stato = page.locator('#saveStatus');

  await page.click('#saveBtn');
  await expect(stato).toHaveText('Salvato e propagato a tutti gli utenti.', { timeout: 8_000 });

  // Un campo qualunque: la regola è una sola per tutta la pagina.
  const row = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  await row.locator('.sn-model-sort').selectOption('latency');
  await expect(stato).toHaveText('Modifiche non ancora propagate.');

  await page.selectOption('#providerSort', 'price');
  await expect(stato).toHaveText('Modifiche non ancora propagate.');

  await page.click('#addModelRow');
  await expect(stato).toHaveText('Modifiche non ancora propagate.');
});

test('il Prova di una riga su Automatico parte con la scelta generale che si vede, anche prima di salvare', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { providerSort: 'price' });

  await page.selectOption('#providerSort', 'throughput');
  const row = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  await row.getByRole('button', { name: 'Prova' }).click();
  await expect(row.locator('.sn-model-row-status')).toContainText('123', { timeout: 8_000 });

  const sent = await page.evaluate(() => window.__sent.filter((m) => m.type === 'test_default_model'));
  expect(sent[sent.length - 1].sort).toBe('throughput');
});

test('scegliere il modello dalla tendina rimette in discussione la misura, come riscriverlo a mano', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab);
  const row = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  const stato = row.locator('.sn-model-row-status');

  await row.getByRole('button', { name: 'Prova' }).click();
  await expect(stato).toContainText('123', { timeout: 8_000 });

  await row.locator('.sn-model-id').click();
  await page.locator('.sn-select-pop [data-value="meta-llama/llama-4-maverick:free"]').first().click();

  await expect(row.locator('.sn-model-id')).toHaveValue('meta-llama/llama-4-maverick:free');
  await expect(stato, 'la misura del modello di prima resta sotto un modello mai provato').not.toContainText('123');
});

// Quello che sta sullo schermo e quello che è partito agli utenti non sono la
// stessa cosa: la pagina non deve annunciare un salvataggio che non contiene
// ciò che si vede, né far sparire una riga senza dire perché.
test('una riga senza nickname non si perde in silenzio: viene segnalata e il salvataggio non si dichiara intero', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab);
  const stato = page.locator('#saveStatus');

  await page.click('#addModelRow');
  const nuova = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  await nuova.locator('.sn-model-id').fill('vendor/dimenticato');
  await nuova.locator('.sn-model-sort').selectOption('latency');
  await page.click('#saveBtn');

  await expect(stato).toHaveText('Salvato — una riga evidenziata sotto non è stata propagata.', { timeout: 8_000 });
  await expect(nuova).toHaveClass(/sn-row-invalid/);
  await expect(nuova.locator('.sn-model-row-msg')).toHaveText('Il nickname è obbligatorio');
  await expect(nuova.locator('.sn-model-id'), 'la riga scartata sparisce dallo schermo').toHaveValue('vendor/dimenticato');
});

test('una riga con un nickname già usato viene segnalata e resta sullo schermo', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab);
  const stato = page.locator('#saveStatus');

  await page.click('#addModelRow');
  const nuova = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  await nuova.locator('.sn-model-nick').fill('esistente');
  await nuova.locator('.sn-model-id').fill('vendor/doppio');
  await page.click('#saveBtn');

  await expect(stato).toHaveText('Salvato — una riga evidenziata sotto non è stata propagata.', { timeout: 8_000 });
  await expect(nuova.locator('.sn-model-row-msg')).toHaveText('Nickname duplicato: esistente');
  await expect(nuova.locator('.sn-model-id')).toHaveValue('vendor/doppio');
});

test('il criterio degli host scelto mentre il salvataggio viaggia resta, e la conferma non lo dà per propagato', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { ritardoSalvataggioMs: 900 });
  const stato = page.locator('#saveStatus');
  const row = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();

  await page.click('#saveBtn');
  await row.locator('.sn-model-sort').selectOption('price');

  await expect(stato).toHaveText('Modifiche non ancora propagate.', { timeout: 8_000 });
  await expect(row.locator('.sn-model-sort')).toHaveValue('price');
});

test('la scelta generale cambiata mentre il salvataggio viaggia resta, e la conferma non la dà per propagata', async ({ openTab }) => {
  const page = await openStubbedEditor(openTab, { ritardoSalvataggioMs: 900 });
  const stato = page.locator('#saveStatus');

  await page.click('#saveBtn');
  await page.selectOption('#providerSort', 'throughput');

  await expect(stato).toHaveText('Modifiche non ancora propagate.', { timeout: 8_000 });
  await expect(page.locator('#providerSort')).toHaveValue('throughput');
});
