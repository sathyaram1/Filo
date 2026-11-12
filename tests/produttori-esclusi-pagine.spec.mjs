// #1059: nelle pagine dove l'owner sceglie i modelli (Modelli predefiniti, Modelli dei giudici), un soprannome che
// porta a un modello il cui produttore non è escluso lo dice accanto alla riga, mentre lo si imposta. Nei Modelli
// predefiniti il bottone accanto lo esclude; la lista e i suoi cambi decidono l'avviso.

import { test, expect } from './fixtures/electron.mjs';
import { GESTIONE as MANAGE_URL, ricaricaSu } from './helpers/gestione.mjs';

const CATALOGO = [
  { name: 'Xiaomi', slug: 'xiaomi' },
  { name: 'DeepSeek', slug: 'deepseek' },
  { name: 'Z.AI', slug: 'z-ai' },
  { name: 'DeepInfra', slug: 'deepinfra' },
  { name: 'Anthropic', slug: 'anthropic' },
  { name: 'Google Vertex', slug: 'google-vertex' },
];

async function apriModelliPredefiniti(openTab, cfg) {
  const page = await openTab(MANAGE_URL);
  await page.addInitScript(({ cfg, CATALOGO }) => {
    window.__sent = [];
    const stub = async (msg) => {
      window.__sent.push(msg);
      switch (msg.type) {
        case 'defaults_get': return { ok: true, config: cfg };
        case 'default_providers_list': return { ok: true, items: CATALOGO };
        case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
        case 'defaults_update': return { ok: true, config: { ...cfg, ...(msg.config || {}) } };
        default: return { ok: true };
      }
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  }, { cfg, CATALOGO });
  await ricaricaSu(page, 'predefiniti');
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  return page;
}

// Le righe nascono nell'ordine del registro; il soprannome sta nel valore del campo, non in un attributo.
const ORDINE = ['mimo', 'ds', 'claude', 'kokoro'];
const rigaDi = (page, nick) => page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').nth(ORDINE.indexOf(nick));

test('Modelli predefiniti: il produttore scoperto si vede sulla riga e si esclude da lì', async ({ openTab }) => {
  const page = await apriModelliPredefiniti(openTab, {
    apiKeysPresent: { openrouter: true },
    modelRegistry: {
      mimo: { provider: 'openrouter', model: 'xiaomi/mimo-v2.6-flash' },
      ds: { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
      claude: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' },
      kokoro: { provider: 'openrouter', model: 'hexgrad/kokoro-82m' },
    },
    models: {},
    // La lista salvata dall'owner prima che Xiaomi entrasse in quella del codice.
    excludedProviders: ['Google', 'DeepSeek'],
  });

  await expect(rigaDi(page, 'mimo').locator('.sn-model-nick')).toHaveValue('mimo');
  await expect(rigaDi(page, 'kokoro').locator('.sn-model-nick')).toHaveValue('kokoro');
  const avvisoMimo = rigaDi(page, 'mimo').locator('.sn-model-row-warn');
  await expect(avvisoMimo).toBeVisible();
  await expect(avvisoMimo).toContainText('Xiaomi produce questo modello');
  // Escluso, comprato dal produttore per politica, o senza host: niente da dire.
  for (const nick of ['ds', 'claude', 'kokoro']) await expect(rigaDi(page, nick).locator('.sn-model-row-warn')).toBeHidden();
  await page.locator('#modelRegistryList').screenshot({ path: 'tests/.shots/produttori-esclusi-predefiniti.png' });

  // Mentre si scrive un altro modello l'avviso lo segue.
  const idDs = rigaDi(page, 'ds').locator('.sn-model-id');
  await idDs.fill('z-ai/glm-5.2');
  await expect(rigaDi(page, 'ds').locator('.sn-model-row-warn')).toContainText('Z.AI produce questo modello');
  await idDs.fill('deepseek/deepseek-v4-flash');
  await expect(rigaDi(page, 'ds').locator('.sn-model-row-warn')).toBeHidden();

  // Il bottone mette il produttore nella lista: l'avviso sparisce e il salvataggio lo porta.
  await avvisoMimo.getByRole('button', { name: 'Escludi Xiaomi' }).click();
  await expect(avvisoMimo).toBeHidden();
  const nomi = page.locator('#excludedList .sn-excluded-name');
  await expect(nomi.last()).toHaveValue('Xiaomi');
  await expect(page.locator('#excludedList .sn-excluded-row').last().locator('.sn-excluded-kind')).toHaveValue('producer');
  await page.locator('#saveBtn').click();
  await expect.poll(() => page.evaluate(() => {
    const upd = window.__sent.filter((m) => m.type === 'defaults_update').pop();
    return upd && upd.config && upd.config.excludedProviders;
  })).toContain('Xiaomi');

  // Tolto dalla lista, l'avviso torna.
  await page.locator('#excludedList .sn-excluded-row').last().locator('.sn-btn-secondary').click();
  await expect(avvisoMimo).toBeVisible();
});

test('Modelli dei giudici: la riga dice quando il produttore resta fra gli host dei giudici', async ({ openTab }) => {
  const page = await openTab(MANAGE_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderSupportModelsEditor);
  await page.evaluate(() => window.__mgTest.setTab('automation'));
  await page.evaluate((m) => window.__mgTest.renderSupportModelsEditor(m), {
    judge1: 'mimo', judge2: '', judge3: '', judgeDynamic: '', judgeRedTeam: '', judgePriority: '', sanitizer: '',
    judgeRegistry: {
      mimo: { provider: 'openrouter', model: 'xiaomi/mimo-v2.6-flash' },
      ignoto: { provider: 'openrouter', model: 'acme-labs/giudice-1' },
    },
    openrouterKeyPresent: true,
  });
  const righe = page.locator('#mgSmRegistryList .sn-model-row:not(.sn-model-row-head)');
  const riga = (nick) => righe.nth(['mimo', 'ignoto'].indexOf(nick));

  await expect(riga('ignoto').locator('.sn-model-nick')).toHaveValue('ignoto');
  // Il caso della segnalazione: con Xiaomi nella lista del codice il giudice MiMo è a posto.
  await expect(riga('mimo').locator('.sn-model-row-warn')).toBeHidden();
  await expect(riga('ignoto').locator('.sn-model-row-warn')).toBeVisible();
  await expect(riga('ignoto').locator('.sn-model-row-warn')).toContainText('acme-labs produce questo modello');

  // Una riga nuova avvisa mentre si scrive.
  await page.locator('#mgSmRegistryAdd').click();
  const nuova = righe.last();
  await nuova.locator('.sn-model-id').fill('nuovolab/modello-2');
  await expect(nuova.locator('.sn-model-row-warn')).toContainText('nuovolab');
  await nuova.locator('.sn-model-id').fill('anthropic/claude-haiku-4.5');
  await expect(nuova.locator('.sn-model-row-warn')).toBeHidden();
  await nuova.locator('.sn-model-id').fill('acme-labs/giudice-1');
  await nuova.locator('.sn-model-id').press('Escape');

  await page.locator('#mgSmRegistry').screenshot({ path: 'tests/.shots/produttori-esclusi-giudici.png' });
});
