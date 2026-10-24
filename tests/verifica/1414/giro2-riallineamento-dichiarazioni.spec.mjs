// #1414 giro 2 (riallineamento): la regola arrivata da main nell'editor dei modelli predefiniti, ora dentro Gestione.
// Salvando, ciò che la voce dichiara del modello (pesi, ingressi, uscite) resta solo se il modello è ancora quello.
// Prova senza rilievo: la zona del riallineamento, ri-provata.

import { test, expect } from '../../fixtures/electron.mjs';
import { GESTIONE, ricaricaSu } from '../../helpers/gestione.mjs';

async function editor(openTab) {
  const page = await openTab(GESTIONE);
  await page.addInitScript(() => {
    const cfg = {
      apiKeysPresent: { openrouter: true },
      safeBrowsingKeyPresent: false,
      modelRegistry: {
        resta: { provider: 'openrouter', model: 'acme/aperto', weights: 'open', inputs: ['text'], outputs: ['text'] },
        cambia: { provider: 'openrouter', model: 'acme/vecchio', weights: 'open', inputs: ['text'] },
      },
      models: {},
      excludedProviders: null,
    };
    window.__sent = [];
    const stub = async (msg) => {
      window.__sent.push(msg);
      if (msg.type === 'defaults_get') return { ok: true, config: cfg };
      if (msg.type === 'defaults_update') return { ok: true, config: { ...cfg, ...(msg.config || {}) } };
      if (msg.type === 'default_models_list' || msg.type === 'default_providers_list') return { ok: true, items: [] };
      return { ok: true };
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  });
  await ricaricaSu(page, 'predefiniti');
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  return page;
}

test('in Gestione il salvataggio tiene le dichiarazioni del modello rimasto e le toglie a quello cambiato', async ({ openTab }) => {
  const page = await editor(openTab);
  const righe = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
  await expect(righe).toHaveCount(2);
  const nomi = await righe.locator('.sn-model-nick').evaluateAll((els) => els.map((e) => e.value));
  await righe.nth(nomi.indexOf('cambia')).locator('.sn-model-id').fill('acme/nuovo');
  await page.click('#saveBtn');
  await expect.poll(() => page.evaluate(() => window.__sent.some((m) => m.type === 'defaults_update'))).toBe(true);
  const reg = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop().config.modelRegistry);
  expect(reg.resta).toMatchObject({ model: 'acme/aperto', weights: 'open', inputs: ['text'], outputs: ['text'] });
  expect(reg.cambia.model).toBe('acme/nuovo');
  expect(reg.cambia.weights).toBeUndefined();
  expect(reg.cambia.inputs).toBeUndefined();
});
