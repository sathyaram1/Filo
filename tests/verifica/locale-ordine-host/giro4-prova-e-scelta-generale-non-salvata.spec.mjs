// Una misura del «Prova» vale per la configurazione con cui è stata presa.
// Il criterio scritto nella riga viaggia con la prova anche prima del
// salvataggio; la scelta generale no: la prova parte con quella vecchia e la
// misura viene archiviata sotto quella nuova.

import { test, expect } from '../../fixtures/electron.mjs';

const MODELLI_PREDEFINITI = 'filo://admin-defaults/admin-defaults.html';

async function apriEditor(openTab) {
  const page = await openTab(MODELLI_PREDEFINITI);
  await page.addInitScript(() => {
    const config = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: {
        normale: { provider: 'openrouter', model: 'vendor/due' },
      },
      models: {},
      excludedProviders: [],
      providerSort: 'price',
    };
    window.__proveChieste = [];
    window.chrome = window.chrome || {};
    const attacca = () => {
      if (!window.chrome || !window.chrome.runtime) { setTimeout(attacca, 5); return; }
      const vero = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
      window.chrome.runtime.sendMessage = async (msg) => {
        switch (msg.type) {
          case 'defaults_get': return { ok: true, config };
          case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
          case 'defaults_update': return { ok: true, config };
          case 'test_default_model':
            window.__proveChieste.push({ sort: msg.sort, model: msg.model });
            return { ok: true, ttftMs: 42, tokensPerSec: 77.7 };
          default: return vero(msg);
        }
      };
    };
    attacca();
  });
  await page.reload();
  await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 15_000 });
  return page;
}

const riga = (page) => page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
const stato = (page) => page.evaluate(() => {
  const r = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
  const s = r && r.querySelector('.sn-model-row-status');
  return ((s && s.textContent) || '').trim();
});

// Riferimento: il criterio scelto sulla riga viaggia con la prova anche prima
// del salvataggio. È la metà che funziona, e il metro per la gemella.
test('Modelli predefiniti: il criterio scelto sulla riga parte con la prova anche prima di salvare', async ({ openTab }) => {
  const page = await apriEditor(openTab);
  await riga(page).locator('.sn-model-sort').selectOption('latency');
  await riga(page).locator('button').last().click();
  await expect.poll(() => stato(page), { timeout: 10_000 }).toMatch(/TTFT/);

  const chieste = await page.evaluate(() => window.__proveChieste);
  expect(chieste[0].sort, 'la prova non porta con sé il criterio appena scelto sulla riga').toBe('latency');
});

test('Modelli predefiniti: la prova di una riga su Automatico parte con la scelta generale che si vede nella pagina', async ({ openTab }) => {
  const page = await apriEditor(openTab);
  // La riga resta su «Automatico»: rimanda alla scelta generale, che qui viene
  // cambiata da «più economico» a «più veloce» e non ancora salvata.
  await page.selectOption('#providerSort', 'throughput');
  await riga(page).locator('button').last().click();
  await expect.poll(() => stato(page), { timeout: 10_000 }).toMatch(/TTFT/);

  // La misura compare, quindi la pagina la considera valida per «più veloce».
  const chieste = await page.evaluate(() => window.__proveChieste);
  expect(chieste[0].sort,
    'la misura viene mostrata come se fosse stata presa con la scelta generale nuova, ma la prova è partita senza dirlo a nessuno: il numero parla di un criterio diverso da quello scritto accanto')
    .toBe('throughput');
});
