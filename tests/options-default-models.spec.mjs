// Switch "Usa modelli predefiniti" nella pagina Opzioni.
//
// Requisito: di base l'utente usa modelli/chiavi predefiniti senza configurare
// nulla, quindi lo switch è ON e la config avanzata (provider/chiavi, registry,
// modelli per azione) è NASCOSTA. Disattivando lo switch la config compare e la
// scelta si persiste.
//
// Pre-condizione che senza il fix fallirebbe: prima non esisteva lo switch e le
// sezioni erano sempre visibili; ora di default sono nascoste (#sec-provider
// non è visibile) e ricompaiono solo a switch OFF.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

test('Opzioni: lo switch è ON di default e nasconde provider/registry/modelli', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

  await expect(page.locator('#useDefaultModels')).toBeChecked();
  await expect(page.locator('#sec-provider')).toBeHidden();
  await expect(page.locator('#sec-model-registry')).toBeHidden();
  await expect(page.locator('#sec-models')).toBeHidden();
});

test('Opzioni: disattivare lo switch rivela la config e la scelta si persiste', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

  await page.uncheck('#useDefaultModels');

  // Le sezioni avanzate diventano visibili immediatamente.
  await expect(page.locator('#sec-provider')).toBeVisible();
  await expect(page.locator('#sec-model-registry')).toBeVisible();
  await expect(page.locator('#sec-models')).toBeVisible();

  // L'auto-save lampeggia la conferma.
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Ricaricando, lo switch è ancora OFF e la config resta visibile.
  await page.reload();
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await expect(page.locator('#useDefaultModels')).not.toBeChecked();
  await expect(page.locator('#sec-provider')).toBeVisible();
});

// La misura del pulsante «Prova» è di chi l'ha fatta: la lista dei modelli
// predefiniti è in sola lettura, e senza un posto dove tenerla spariva a ogni
// ricaricamento proprio dove sta quasi tutta la gente (switch acceso).
test('Opzioni: la misura del «Prova» di un modello predefinito resta dopo il ricaricamento', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai/')) return vero(url, init);
      if (u.includes('/chat/completions')) {
        const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
          + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9}}\n\n'
          + 'data: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: true,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta' },
    });
  });

  const riga = (page) => page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
  const page = await openTab(OPTIONS_URL);
  await riga(page).waitFor({ timeout: 15_000 });
  await riga(page).locator('.sn-model-test').click();
  await expect(riga(page).locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });

  await page.reload();
  await riga(page).waitFor({ timeout: 15_000 });
  await expect(riga(page).locator('.sn-model-row-status'), 'la misura è sparita col ricaricamento')
    .toHaveText(/TTFT\s+\d/, { timeout: 10_000 });
});

test('Opzioni: riattivare lo switch ri-nasconde la config', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

  await page.uncheck('#useDefaultModels');
  await expect(page.locator('#sec-provider')).toBeVisible();

  await page.check('#useDefaultModels');
  await expect(page.locator('#sec-provider')).toBeHidden();
  await expect(page.locator('#sec-models')).toBeHidden();
});

// Una riga su «Automatico» segue la scelta generale degli host: cambiata
// quella, i numeri di prima parlano di un altro modo di scegliere l'host, e
// restare sullo schermo come se valessero ancora è peggio che sparire.
test('Opzioni: cambiata la scelta generale degli host, la misura di prima non resta', async ({ app, openTab }) => {
  const generaleA = (valore) => app.evaluate(async (_e, v) => {
    const D = globalThis.__filoDefaults;
    if (!globalThis.__getVeroGenerale) globalThis.__getVeroGenerale = D.get;
    D.get = (...a) => ({ ...globalThis.__getVeroGenerale(...a), providerSort: v });
  }, valore);

  await app.evaluate(async () => {
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai/')) return vero(url, init);
      if (u.includes('/chat/completions')) {
        const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
          + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9}}\n\n'
          + 'data: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: true,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta' },
    });
  });
  await generaleA('price');

  const riga = (page) => page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
  const page = await openTab(OPTIONS_URL);
  await riga(page).waitFor({ timeout: 15_000 });
  await riga(page).locator('.sn-model-test').click();
  await expect(riga(page).locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });

  await generaleA('throughput');
  await page.reload();
  await riga(page).waitFor({ timeout: 15_000 });
  await expect(riga(page).locator('.sn-model-row-status'),
    'la misura parla di un ordinamento che non è più quello in vigore')
    .toHaveText(/Non ancora testato/, { timeout: 10_000 });
});
