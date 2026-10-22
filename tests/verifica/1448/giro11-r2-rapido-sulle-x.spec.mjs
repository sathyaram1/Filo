// Verifica #1448 giro 11 (riallineamento): il controllo rapido misurato sul banco non dice più che le x di un segnaposto
// non sono errori; se il modello le segna come errore, sopra «14xx» compare l'onda dell'errore insieme al valore.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea>
</body>`;

test('r2 una riga del controllo rapido sulle x di un segnaposto non diventa un errore', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: true },
    });
    globalThis.__rapide = 0;
    const finto = async ({ messages }) => {
      const sistema = String(messages[0].content);
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (sistema.includes('Sei il controllo rapido')) {
        globalThis.__rapide += 1;
        return fine(t.includes('14xx') ? '[14xx][1492][anno scritto a metà][errore]' : 'NIENTE');
      }
      if (sistema.includes('proponi SUGGERIMENTI') && t.includes('14xx')) {
        return fine('[nel 14xx][nel 1492][Cristoforo Colombo sbarcò in America il 12 ottobre 1492][segnaposto]');
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ta').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx. ");
  await expect(page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' })).toBeVisible({ timeout: 8000 });
  await expect.poll(() => app.evaluate(() => globalThis.__rapide), { timeout: 8000 }).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  await expect(page.locator('.sn-spell-overlay .sn-errore', { hasText: '14xx' })).toHaveCount(0);
});
