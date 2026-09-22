// A che larghezza di finestra la riga dei modelli predefiniti smette di essere
// usabile: il campo della stringa del modello è l'unico elastico, e quando le
// colonne fisse superano lo spazio si schiaccia a zero e i pulsanti escono.

import { test, expect } from '../../fixtures/electron.mjs';

const MODELLI_PREDEFINITI = 'filo://admin-defaults/admin-defaults.html';

const CONFIG = {
  apiKeysPresent: { openrouter: true, tavily: false },
  safeBrowsingKeyPresent: false,
  modelRegistry: { veloce: { provider: 'openrouter', model: 'vendor/modello-lungo-abbastanza', sort: 'throughput' } },
  models: {},
  excludedProviders: [],
  providerSort: '',
};

test('il campo della stringa del modello resta visibile alle larghezze di finestra normali', async ({ openTab }) => {
  const page = await openTab(MODELLI_PREDEFINITI);
  await page.addInitScript((config) => {
    window.chrome = window.chrome || {};
    const attacca = () => {
      if (!window.chrome || !window.chrome.runtime) { setTimeout(attacca, 5); return; }
      window.chrome.runtime.sendMessage = async (msg) => {
        switch (msg.type) {
          case 'defaults_get': return { ok: true, config };
          case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
          case 'defaults_update': return { ok: true, config };
          default: return { ok: true };
        }
      };
    };
    attacca();
  }, CONFIG);
  await page.reload();
  await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 15_000 });

  const misure = [];
  for (const larghezza of [1280, 1024, 900, 800, 720]) {
    await page.setViewportSize({ width: larghezza, height: 800 });
    await page.waitForTimeout(200);
    misure.push(await page.evaluate((w) => {
      const riga = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
      const campo = riga.querySelector('.sn-model-id');
      const prova = Array.from(riga.querySelectorAll('button')).pop();
      const viewport = document.documentElement.clientWidth;
      return {
        larghezza: w,
        campoModello: Math.round(campo.getBoundingClientRect().width),
        provaOltreLoSchermo: Math.round(prova.getBoundingClientRect().right - viewport),
      };
    }, larghezza));
  }
  await page.screenshot({ path: 'tests/.shots/ordine-host-larghezza-900.png' });

  const rotte = misure.filter((m) => m.campoModello < 60 || m.provaOltreLoSchermo > 0);
  expect(rotte, `larghezze in cui la riga non è più usabile: ${JSON.stringify(misure)}`).toEqual([]);
});
