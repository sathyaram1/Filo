import { test, expect } from './fixtures/electron.mjs';
const PAGINA = '<!doctype html><title>G</title>' + Array.from({ length: 40 }, (_, i) => `<details id="sez${i}"><summary>Sezione ${i}</summary><p>T ${i}</p></details>`).join('');
test('debug', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.HELP]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
    globalThis.__n = 0;
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return fatto('{}');
      globalThis.__n++;
      return fatto(JSON.stringify({ highlight: { selector: `#sez${globalThis.__n - 1}`, action: 'reveal' }, status: 'continue' }));
    };
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  });
  const sito = await testServer.openReady(openTab, PAGINA);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await sito.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await sito.fill('.sn-sidebar-input textarea', 'ciao');
  await sito.press('.sn-sidebar-input textarea', 'Enter');
  for (let k = 0; k < 4; k++) {
    await sito.waitForTimeout(9000);
    console.log(k, await app.evaluate(() => globalThis.__n), await sito.evaluate(() => {
      const r = document.querySelector('.sn-sidebar');
      return r ? r.className + ' | conv ' + getComputedStyle(r.querySelector('.sn-sidebar-conv')).display + ' | conv h ' + r.querySelector('.sn-sidebar-conv').clientHeight + '/' + r.querySelector('.sn-sidebar-conv').scrollHeight + ' | heights ' + [...r.querySelector('.sn-sidebar-conv').children].map((l) => l.className.replace('sn-sidebar-','') + ':' + Math.round(l.getBoundingClientRect().height)).join(',') : 'nessuna';
    }));
  }
});
