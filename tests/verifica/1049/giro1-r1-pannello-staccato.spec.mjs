// #1049 verifica giro 1, rilievo 1 — la pagina stacca il pannello dell'Aiuto: i passi che faceva da solo devono finire
// con lui, non continuare a spendere senza che l'utente li veda né possa fermarli.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = '<!doctype html><title>Guida infinita</title><h1>Guida</h1>'
  + Array.from({ length: 120 }, (_, i) => `<details id="sez${i}"><summary>Sezione ${i}</summary><p>Testo ${i}</p></details>`).join('');

test('r1 la pagina toglie il pannello dell\'Aiuto: le chiamate da sole si fermano con lui', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__aiuto = 0;
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return fatto('{}');
      const n = ++globalThis.__aiuto;
      return fatto(JSON.stringify({ highlight: { selector: `#sez${n - 1}`, action: 'reveal' }, status: 'continue' }));
    };
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  });
  const sito = await testServer.openReady(openTab, PAGINA);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await sito.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await sito.fill('.sn-sidebar-input textarea', 'cosa dice?');
  await sito.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__aiuto), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);

  // Il codice della pagina toglie il pannello: per l'utente l'Aiuto è chiuso.
  await sito.evaluate(() => document.querySelector('.sn-sidebar').remove());
  const alDistacco = await app.evaluate(() => globalThis.__aiuto);
  await sito.waitForTimeout(12_000);
  const dopo = await app.evaluate(() => globalThis.__aiuto);
  // Al più la chiamata già in volo.
  expect(dopo - alDistacco, 'chiamate partite a pannello sparito').toBeLessThanOrEqual(1);
});
