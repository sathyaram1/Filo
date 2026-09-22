// La conferma «Salvato» delle Preferenze adesso si spegne appena arriva una
// modifica nuova. La pagina dei modelli predefiniti — quella dove si sceglie il
// criterio degli host — ha la stessa conferma e non si spegne mai.

import { test, expect } from '../../fixtures/electron.mjs';

const MODELLI_PREDEFINITI = 'filo://admin-defaults/admin-defaults.html';

async function apriEditor(openTab) {
  const page = await openTab(MODELLI_PREDEFINITI);
  await page.addInitScript(() => {
    const config = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: {
        veloce: { provider: 'openrouter', model: 'vendor/uno', sort: 'throughput' },
        normale: { provider: 'openrouter', model: 'vendor/due' },
      },
      models: {},
      excludedProviders: [],
      providerSort: '',
    };
    window.chrome = window.chrome || {};
    const attacca = () => {
      if (!window.chrome || !window.chrome.runtime) { setTimeout(attacca, 5); return; }
      const vero = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
      window.chrome.runtime.sendMessage = async (msg) => {
        switch (msg.type) {
          case 'defaults_get': return { ok: true, config };
          case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
          case 'defaults_update': return { ok: true, config };
          case 'test_default_model': return { ok: true, ttftMs: 42, tokensPerSec: 77.7 };
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

const stato = (page) => page.evaluate(() => (document.getElementById('saveStatus').textContent || '').trim());

async function salvaEAspettaLaConferma(page) {
  await page.click('#saveBtn');
  await expect.poll(() => stato(page), { timeout: 10_000, message: 'la conferma non è mai comparsa' })
    .toMatch(/Salvato/);
}

test('Modelli predefiniti: la conferma «Salvato» si spegne appena si cambia il criterio degli host di una riga', async ({ openTab }) => {
  const page = await apriEditor(openTab);
  await salvaEAspettaLaConferma(page);

  const sort = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first().locator('.sn-model-sort');
  await sort.selectOption('latency');
  await page.waitForTimeout(500);

  expect(await stato(page),
    'la conferma «Salvato e propagato a tutti gli utenti» resta accesa mentre il criterio appena scelto non è stato propagato a nessuno')
    .toBe('Modifiche non ancora propagate.');
});

test('Modelli predefiniti: la conferma «Salvato» si spegne anche cambiando la scelta generale degli host', async ({ openTab }) => {
  const page = await apriEditor(openTab);
  await salvaEAspettaLaConferma(page);

  await page.selectOption('#providerSort', 'price');
  await page.waitForTimeout(500);

  expect(await stato(page),
    'la conferma resta accesa mentre la scelta generale appena fatta non è salvata')
    .toBe('Modifiche non ancora propagate.');
});
