// Verifica locale «esclusione Alibaba», giro 3: un'installazione che legge una lista di esclusione
// salvata dall'owner prima di questo lavoro (senza «Alibaba») non riceve la voce nuova del codice:
// la pagina Modelli predefiniti deve accorgersene, nominarla e rimetterla, e il salvataggio portarla.

import { test, expect } from '../../fixtures/electron.mjs';

const ADMIN_URL = 'filo://admin-defaults/admin-defaults.html';
const LISTA_VECCHIA = ['Google', 'OpenAI', 'xAI', 'DeepSeek', 'Mistral', 'Moonshot AI', 'MiniMax', 'Qwen', 'Cohere', 'Meta', 'Z.AI', 'Novita'];
const CATALOGO = [
  { name: 'Alibaba', slug: 'alibaba' },
  { name: 'DeepInfra', slug: 'deepinfra' },
  { name: 'Google', slug: 'google-vertex' },
  { name: 'Novita', slug: 'novita' },
];

async function apriPagina(openTab, excludedProviders) {
  const page = await openTab(ADMIN_URL);
  await page.addInitScript(({ excludedProviders, CATALOGO }) => {
    const cfg = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: {},
      models: {},
      excludedProviders,
    };
    if (cfg.excludedProviders == null) {
      Object.defineProperty(cfg, 'excludedProviders', {
        get: () => (window.SN_CONST && window.SN_CONST.DEFAULT_EXCLUDED_PROVIDERS) || [],
      });
    }
    window.__sent = [];
    const stub = async (msg) => {
      window.__sent.push(msg);
      switch (msg.type) {
        case 'defaults_get': return { ok: true, config: cfg };
        case 'default_providers_list': return { ok: true, items: CATALOGO };
        case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
        case 'defaults_update': return { ok: true, config: { ...cfg, excludedProviders: (msg.config && msg.config.excludedProviders) || cfg.excludedProviders } };
        default: return { ok: true };
      }
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  }, { excludedProviders, CATALOGO });
  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 10_000 });
  return page;
}

const nomi = (page) => page.locator('#excludedList .sn-excluded-name').evaluateAll((els) => els.map((e) => e.value));

test('lista salvata prima del lavoro: la pagina nomina Alibaba, la rimette come produttore e il salvataggio la porta', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await apriPagina(openTab, LISTA_VECCHIA);
  const drift = page.locator('#excludedDrift');
  await expect(drift).toBeVisible();
  await expect(drift).toContainText('Alibaba');
  await page.screenshot({ path: 'tests/.shots/verifica-alibaba-owner-drift.png', fullPage: true }).catch(() => {});

  await drift.getByRole('button', { name: 'Rimettili nella lista' }).click();
  await expect(drift).toBeHidden();
  expect(await nomi(page)).toContain('Alibaba');
  const riga = page.locator('#excludedList .sn-excluded-row').filter({ has: page.locator('.sn-excluded-name[value="Alibaba"], .sn-excluded-name') })
    .filter({ hasText: '' });
  const alibaba = await page.locator('#excludedList .sn-excluded-row').evaluateAll((rs) => rs
    .map((r) => ({ nome: r.querySelector('.sn-excluded-name').value, tipo: (r.querySelector('.sn-excluded-kind') || {}).value, msg: (r.querySelector('.sn-model-row-msg') || {}).textContent || '' }))
    .find((x) => x.nome === 'Alibaba'));
  expect(riga).toBeTruthy();
  expect(alibaba.tipo).toBe('producer');
  expect(alibaba.msg.trim()).toBe('');

  await page.click('#saveBtn');
  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect(upd && upd.config && upd.config.excludedProviders).toContain('Alibaba');
});

test('una lista che scrive «Alibaba Cloud» non copre l\'host vero: la pagina lo dice', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await apriPagina(openTab, [...LISTA_VECCHIA, 'Alibaba Cloud']);
  await expect(page.locator('#excludedDrift')).toBeVisible();
  await expect(page.locator('#excludedDrift')).toContainText('Alibaba');
});

test('senza lista dell\'owner vale quella del codice: Alibaba c\'è, nessun avviso sulla sua riga', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await apriPagina(openTab, null);
  await expect(page.locator('#excludedDrift')).toBeHidden();
  expect(await nomi(page)).toContain('Alibaba');
  const msg = await page.locator('#excludedList .sn-excluded-row').evaluateAll((rs) => rs
    .filter((r) => r.querySelector('.sn-excluded-name').value === 'Alibaba')
    .map((r) => ((r.querySelector('.sn-model-row-msg') || {}).textContent || '').trim()));
  expect(msg).toEqual(['']);
  await page.click('#saveBtn');
  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect('excludedProviders' in ((upd && upd.config) || {})).toBe(false);
});
