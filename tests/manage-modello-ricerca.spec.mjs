// #465: il modello della ricerca fra i feedback si imposta in Gestione →
// Modelli di supporto (non più in Opzioni né in Modelli predefiniti), e il campo
// «Modello OpenRouter» del registro propone i modelli del catalogo mentre scrivi.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const MODELS = {
  sanitizer: '', judge1: 'giudice-veloce', judge2: '', judge3: '', judgeDynamic: '',
  judgeRedTeam: '', judgePriority: '',
  manageSearch: 'deepseek-flash',
  judgeRegistry: { 'giudice-veloce': { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' } },
  sharedNicknames: [{ nick: 'deepseek-flash', label: 'DeepSeek Flash' }],
  openrouterKeyPresent: true,
};

const CATALOGO = [
  { id: 'moonshotai/kimi-k2.6', label: 'Multimodale' },
  { id: 'deepseek/deepseek-v4-flash', label: 'Testo' },
  { id: 'qwen/qwen3-embedding-8b', label: 'Indicizzazione' },
];

async function apriModelli(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderSupportModelsEditor && window.filo);
  await page.evaluate((catalogo) => {
    window.__inviati = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'default_models_list') return { ok: true, provider: 'openrouter', items: catalogo };
      if (msg && msg.type === 'support_models_update') {
        window.__inviati.push(msg);
        return { ok: true, models: { ...msg.models, judgeRegistry: msg.judgeRegistry, openrouterKeyPresent: true } };
      }
      return orig(msg);
    };
  }, CATALOGO);
  await page.evaluate(() => window.__mgTest.setTab('models'));
  await page.evaluate((m) => window.__mgTest.renderSupportModelsEditor(m), MODELS);
  await expect(page.locator('#mgSmEditor')).toBeVisible();
}

test('la ricerca fra i feedback ha il suo modello in Gestione → Modelli, e il salvataggio lo porta con sé', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriModelli(page);

  const slot = page.locator('.mg-sm-slot[data-slot="manageSearch"]');
  await expect(slot.locator('label')).toHaveText('Ricerca fra i feedback');
  await expect(slot.locator('.sn-chain-input').first()).toHaveValue('deepseek-flash');

  // I nickname del registro condiviso sono proposti accanto a quelli dei giudici.
  const nick = await page.evaluate(() => Array.from(document.getElementById('nicknames-list').options).map((o) => o.value));
  expect(nick).toEqual(expect.arrayContaining(['giudice-veloce', 'deepseek-flash']));

  const input = slot.locator('.sn-chain-input').first();
  await input.fill('giudice-veloce');
  await input.blur();
  await page.click('#mgSmSaveBtn');
  await expect.poll(() => page.evaluate(() => window.__inviati.length)).toBe(1);
  const inviato = await page.evaluate(() => window.__inviati[0]);
  expect(inviato.models.manageSearch).toBe('giudice-veloce');
  await expect(page.locator('#mgSmStatus')).toHaveText('Salvato.');
});

test('scrivendo nel campo «Modello OpenRouter» del registro compaiono i modelli del catalogo', async ({ openTab }) => {
  const page = await openTab(URL);
  await apriModelli(page);

  await page.click('#mgSmRegistryAdd');
  const riga = page.locator('#mgSmRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  await riga.locator('.sn-model-nick').fill('ricerca');
  const campo = riga.locator('.sn-model-id');
  await campo.click();
  await campo.pressSequentially('kimi');

  const tendina = riga.locator('.sn-select-pop');
  await expect(tendina).toBeVisible();
  await expect(tendina.locator('.sn-select-option')).toHaveCount(1);
  await expect(tendina.locator('.sn-select-option').first()).toContainText('moonshotai/kimi-k2.6');
  await expect(tendina.locator('.sn-select-option').first()).toContainText('Multimodale');

  await tendina.locator('.sn-select-option').first().dispatchEvent('mousedown');
  await expect(campo).toHaveValue('moonshotai/kimi-k2.6');
  await expect(tendina).toBeHidden();

  // Scelto il modello, il nickname diventa subito proponibile ai selettori.
  const nick = await page.evaluate(() => Array.from(document.getElementById('nicknames-list').options).map((o) => o.value));
  expect(nick).toContain('ricerca');
  const reg = await page.evaluate(() => window.__mgTest.collectJudgeRegistry());
  expect(reg.ricerca).toEqual({ provider: 'openrouter', model: 'moonshotai/kimi-k2.6' });

  await page.screenshot({ path: 'tests/.shots/465-registro-catalogo.png', fullPage: false });
});

test('una ricerca fra i feedback parte col modello scelto in Gestione, risolto sul registro dei giudici', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.MANAGE_SEARCH]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const veraFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/documents/config/supportModels')) {
        return new Response(JSON.stringify({ fields: {
          manageSearch: { stringValue: 'cerca-bene' },
          judgeRegistry: { mapValue: { fields: { 'cerca-bene': { mapValue: { fields: {
            provider: { stringValue: 'openrouter' }, model: { stringValue: 'vendor/modello-ricerca' },
          } } } } } },
        } }), { status: 200 });
      }
      if (u.includes('/documents/config/judgeSecrets')) return new Response('{}', { status: 404 });
      return veraFetch(url, opts);
    };
    const P = globalThis.SN_PROVIDERS;
    const veroC = P.completeWithFallback;
    let catena = null;
    P.completeWithFallback = async ({ attempts }) => {
      catena = (attempts || []).map((a) => a.model);
      return { text: '[]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    let errore = null;
    try {
      await globalThis.__filoHandlers.handleAIRequest({
        action: C.ACTIONS.MANAGE_SEARCH,
        payload: { messages: [{ role: 'user', content: 'feedback sulle schede audio' }] },
        origin: 'test',
        noCache: true,
      });
    } catch (e) {
      errore = String((e && e.message) || e);
    } finally {
      P.completeWithFallback = veroC;
      globalThis.fetch = veraFetch;
    }
    return { errore, catena };
  });
  expect(esito.errore).toBeNull();
  expect(esito.catena).toEqual(['vendor/modello-ricerca']);
});
