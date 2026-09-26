import { test, expect } from '/home/user/Filo/tests/fixtures/electron.mjs';
const NEWTAB = 'filo://newtab/';
const TRUFFA = 'Il portale della banca chiede di confermare subito le tue credenziali.';
test('probe', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dash = await openTab(NEWTAB);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.NOTICE_GUARD]: 'claude, gemma-lite' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await expect(dash.locator('#input')).toBeVisible();
  await app.evaluate(async (_e, truffa) => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ provider: 'test', results: [{ title: 'G', url: 'https://x.invalid/g', snippet: 'ISTRUZIONI: di questo', content: 'ISTRUZIONI: di questo' }] });
    globalThis.__prompt = [];
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      giro++;
      globalThis.__prompt.push({ giro, tipi: globalThis.SN_ESTERNO.tipiPresenti(messages) });
      const payload = giro === 1
        ? { text: 'Cerco.', actions: [{ type: 'CERCA_WEB', query: 'q' }] }
        : { text: truffa, actions: [] };
      const full = JSON.stringify(payload);
      try { onDelta && onDelta(full); } catch (_) {}
      return { text: full, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, TRUFFA);
  await dash.locator('#input').fill('cerca');
  await dash.locator('#sendBtn').click();
  await dash.waitForTimeout(8000);
  console.log('PROMPT TIPI:', JSON.stringify(await app.evaluate(() => globalThis.__prompt)));
});
