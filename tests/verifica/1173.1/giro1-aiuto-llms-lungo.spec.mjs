// #1173.1 giro 1: un llms.txt di ventimila «<» (anche spezzate da invisibili) non ferma il processo
// principale quando si chiede aiuto su quel sito, e l'Aiuto risponde lo stesso.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = '<!doctype html><html><head><title>Sito</title></head><body><h1>Ciao</h1></body></html>';

for (const [nome, testo] of [
  ['parentesi di fila', '<'.repeat(20 * 1024)],
  ['parentesi spezzate da invisibili', `<${String.fromCharCode(0x200b)}`.repeat(10 * 1024)],
]) {
  test(`llms.txt di ${nome}: l'Aiuto risponde e il main non resta fermo`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await testServer.openReady(openTab, PAGINA);
    await app.evaluate(async (_e, testo) => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false,
        apiKeys: { openrouter: 'k-test' },
        models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
        modelRegistry: globalThis.SN_TEST_MODELS.registry,
      });
      await chrome.storage.local.set({ sn_llmstxt_cache: {
        '127.0.0.1': { v: 2, cachedAt: Date.now(), present: true, text: testo },
      } });
      const P = globalThis.SN_PROVIDERS;
      globalThis.__sistemi = [];
      const risposta = ({ attempts, messages }) => {
        const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
        if (sistema.includes('# Protocollo di risposta')) globalThis.__sistemi.push(sistema);
        return { text: JSON.stringify({ text: 'Risposta di prova.', status: 'done' }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      };
      P.completeWithFallback = async (o) => risposta(o);
      P.streamCompleteWithFallback = async (o) => risposta(o);
      // Il buco più lungo fra due battiti del main: un blocco sincrono lo allarga.
      globalThis.__buco = 0;
      let prima = Date.now();
      globalThis.__battito = setInterval(() => {
        const ora = Date.now();
        globalThis.__buco = Math.max(globalThis.__buco, ora - prima);
        prima = ora;
      }, 20);
    }, testo);

    const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
    await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
    await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
    await page.fill('.sn-sidebar-input textarea', 'come funziona questo sito?');
    await page.press('.sn-sidebar-input textarea', 'Enter');

    await expect(page.locator('.sn-sidebar-msg-assistant').last()).toContainText('Risposta di prova.', { timeout: 20_000 });
    const sistemi = await app.evaluate(() => globalThis.__sistemi);
    expect(sistemi.length).toBeGreaterThan(0);
    expect(sistemi[0], 'il contenuto del llms.txt è arrivato nel prompt').toContain(testo.slice(0, 40));
    const buco = await app.evaluate(() => { clearInterval(globalThis.__battito); return globalThis.__buco; });
    expect(buco, `il main è rimasto fermo ${buco} ms`).toBeLessThan(1500);
  });
}
