// Verifica #825 giro 2 (esplorazione): archivio migrato grande, indicizzazione con una latenza realistica,
// prima ricerca per contenuto con parole che nel titolo non ci sono.

import { test, expect } from '../../fixtures/electron.mjs';

test('prima ricerca semantica dopo la migrazione, 3000 schede senza vettore, un secondo per blocco', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      globalThis.__chiamate.push({ n: texts.length, at: Date.now() });
      await new Promise((ok) => setTimeout(ok, texts.length > 1 ? 1000 : 300));
      return { vectors: texts.map((t) => (/gattopardo|nobilt/i.test(t) ? [1, 0, 0] : [0, 1, 0.3])) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async () => ({ text: '', provider: 'openrouter', model: 'stub', usage: {} });
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const voci = [];
    for (let i = 0; i < 5000; i++) {
      voci.push({
        id: `m${i}`, url: `https://migrata-${i}.test/`,
        title: i === 4500 ? 'Il Gattopardo' : `Pagina ${i}`,
        summary: i === 4500 ? 'Romanzo di Tomasi di Lampedusa: la nobiltà siciliana davanti all\'Unità.' : `Riassunto qualunque ${i}`,
        closedAt: new Date(Date.UTC(2026, 8, 1) - i * 3600e3).toISOString(), coOpenUrls: [],
        ...(i < 2000 ? { embedding: [0, 127, 40], embedModel: EM } : {}),
      });
    }
    await globalThis.SN_ARCHIVED_TABS.importa(voci);
  });
  const page = await openTab('filo://archive/archive.html');
  await expect(page.locator('.arc-tab').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('#search').fill('libro sulla nobiltà in Sicilia');
  const t0 = Date.now();
  await page.locator('#search').press('Enter');
  await expect(page.locator('#searchNote')).toContainText(/per pertinenza|Nessun risultato/, { timeout: 60_000 });
  const attesa = Date.now() - t0;
  const primo = await page.locator('.arc-results .arc-tab').first().innerText().catch(() => '');
  const senzaVettore = await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).filter((t) => !t.embedding).length);
  console.log(`[v825] attesa prima ricerca ${attesa} ms; primo risultato «${primo.replace(/\s+/g, ' ').slice(0, 60)}»; senza vettore al ritorno ${senzaVettore}`);
  expect(primo).toContain('Il Gattopardo');
});
