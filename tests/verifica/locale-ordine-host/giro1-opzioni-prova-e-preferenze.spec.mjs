// Verifica delle due richieste in coda: l'esito del tasto «Prova» nelle Opzioni
// deve restare visibile dopo il ricaricamento, e la conferma «Salvato» delle
// Preferenze deve riferirsi all'ultima modifica.
//
// Il router non si chiama mai: le richieste si intercettano nel processo main.

import { test, expect } from '../../fixtures/electron.mjs';

const OPZIONI = 'filo://options/options.html';
const PREFERENZE = 'filo://preferences/preferences.html';
const ESITO = /TTFT\s+\d/;

async function intercetta(app) {
  await app.evaluate(async () => {
    if (globalThis.__ordineHostAttivo) { globalThis.__richieste.length = 0; return; }
    globalThis.__ordineHostAttivo = true;
    globalThis.__richieste = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      let corpo = null;
      try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = null; }
      globalThis.__richieste.push({ url: u, corpo });
      if (u.includes('/chat/completions')) {
        const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
          + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":9},"provider":"Baseten"}\n\n'
          + 'data: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
}

test('Opzioni, con i modelli predefiniti accesi: l\'esito della prova resta dopo il ricaricamento', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: true,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
    });
  });
  await intercetta(app);

  const page = await openTab(OPZIONI);
  await page.waitForSelector('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)', { timeout: 15_000 });
  const riga = page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
  await riga.locator('.sn-model-test').click();
  await expect(riga.locator('.sn-model-row-status')).toHaveText(ESITO, { timeout: 20_000 });

  await page.reload();
  await page.waitForSelector('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)', { timeout: 15_000 });
  const dopo = page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
  await expect(dopo.locator('.sn-model-row-status'), 'la misura della prova è sparita col ricaricamento').toHaveText(ESITO, { timeout: 10_000 });
});

test('Opzioni, con i modelli propri: l\'esito della prova resta dopo il ricaricamento', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
      modelRegistry: { mio: { provider: 'openrouter', model: 'finto/mio', sort: 'throughput', reasoning: 'high' } },
    });
  });
  await intercetta(app);

  const page = await openTab(OPZIONI);
  const riga = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')
    .filter({ has: page.locator('.sn-model-nick[value="mio"]') });
  await riga.first().waitFor({ timeout: 15_000 });
  await riga.first().locator('.sn-model-test').click();
  await expect(riga.first().locator('.sn-model-row-status')).toHaveText(ESITO, { timeout: 20_000 });

  await page.reload();
  const dopo = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')
    .filter({ has: page.locator('.sn-model-nick[value="mio"]') });
  await dopo.first().waitFor({ timeout: 15_000 });
  await expect(dopo.first().locator('.sn-model-row-status'), 'la misura della prova è sparita col ricaricamento').toHaveText(ESITO, { timeout: 10_000 });
});

test('Opzioni: la prova di una riga parte con l\'ordinamento scelto per quel modello', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
      modelRegistry: { mio: { provider: 'openrouter', model: 'finto/mio', sort: 'throughput', reasoning: 'high' } },
    });
  });
  await intercetta(app);

  const page = await openTab(OPZIONI);
  const riga = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')
    .filter({ has: page.locator('.sn-model-nick[value="mio"]') });
  await riga.first().waitFor({ timeout: 15_000 });
  await riga.first().locator('.sn-model-test').click();
  await expect(riga.first().locator('.sn-model-row-status')).toHaveText(ESITO, { timeout: 20_000 });

  const partita = await app.evaluate(async () =>
    globalThis.__richieste.filter((r) => r.url.includes('/chat/completions')).pop());
  expect(partita, 'nessuna richiesta partita dalla prova').toBeTruthy();
  expect(partita.corpo.model).toBe('finto/mio');
  expect(partita.corpo.provider && partita.corpo.provider.ignore, 'lista di esclusione assente nella prova').toBeTruthy();
  expect(partita.corpo.provider && partita.corpo.provider.sort,
    'la prova misura la velocità senza l\'ordinamento scelto per quel modello').toBe('throughput');
  expect(partita.corpo.reasoning && partita.corpo.reasoning.effort,
    'la prova misura la velocità senza il livello di ragionamento della riga').toBe('high');
});

test('Preferenze: la conferma «Salvato» non resta accesa su una modifica precedente', async ({ openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#textScale', { timeout: 15_000 });

  // Prima modifica: la conferma compare.
  await page.selectOption('#theme', 'dark');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 5_000 });

  // Seconda modifica, mentre la conferma di prima è ancora sullo schermo: quella
  // conferma parla di uno stato superato e deve sparire finché il nuovo non è
  // salvato, altrimenti chi chiude la pagina crede al sicuro qualcosa che non lo è.
  await page.evaluate(() => {
    const el = document.getElementById('textScale');
    el.value = '1.2';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const accesaSubito = await page.locator('#savedHint').evaluate((el) => el.classList.contains('sn-show'));
  expect(accesaSubito, 'la conferma «Salvato» resta accesa mentre l\'ultima modifica non è ancora salvata').toBe(false);
});
