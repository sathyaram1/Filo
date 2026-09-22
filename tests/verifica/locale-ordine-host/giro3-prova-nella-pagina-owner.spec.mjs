// Il «Prova» delle Opzioni adesso tiene la misura fra una sessione e l'altra.
// Lo stesso pulsante nella pagina dei modelli predefiniti è la strada gemella:
// è lì che si sceglie il criterio degli host e si vuole confrontare una riga
// con l'altra, quindi la misura serve almeno quanto di là.

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
      // Solo i messaggi della config condivisa si fingono: tutto il resto (fra
      // cui il salvataggio delle impostazioni) deve arrivare davvero al main.
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

async function statoPrimaRiga(page) {
  return page.evaluate(() => {
    const riga = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    const stato = riga && riga.querySelector('.sn-model-row-status');
    return (stato && stato.textContent) || '';
  });
}

test('Modelli predefiniti: la misura del «Prova» resta dopo il ricaricamento, come nelle Opzioni', async ({ openTab }) => {
  const page = await apriEditor(openTab);

  const bottoni = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first().locator('button');
  await bottoni.last().click();
  await expect.poll(() => statoPrimaRiga(page), { timeout: 10_000, message: 'la prova non ha prodotto una misura' })
    .toMatch(/TTFT/);

  await page.reload();
  await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 15_000 });
  await page.waitForTimeout(400);

  expect(await statoPrimaRiga(page),
    'la misura appena presa sparisce ricaricando la pagina dei modelli predefiniti')
    .toMatch(/TTFT/);
});

// Nelle Opzioni una riga mai provata lo dice. Qui la riga resta muta, quindi
// non si distingue «non l'ho mai provata» da «l'ho provata e non ha risposto».
test('Modelli predefiniti: una riga mai provata lo dice, come nelle Opzioni', async ({ openTab }) => {
  const page = await apriEditor(openTab);
  expect((await statoPrimaRiga(page)).trim(),
    'una riga mai provata non dice niente, mentre nelle Opzioni lo dice')
    .not.toBe('');
});
