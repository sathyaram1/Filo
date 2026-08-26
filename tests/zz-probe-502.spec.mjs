import { test, expect } from './fixtures/electron.mjs';

test('probe', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });

  const errs = [];
  page.on('console', (m) => errs.push(`[page:${m.type()}] ${m.text()}`));

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.__o = globalThis.SN_PROVIDER_GEMINI;
    globalThis.__called = 0;
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.__o,
      streamComplete: async ({ onDelta }) => {
        globalThis.__called++;
        onDelta('CIAO ');
        onDelta('MONDO');
        return { text: 'CIAO MONDO', usage: {} };
      },
    };
  });

  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'x', sentence: 'frase con x' },
      anchor: { x: 120, y: 100 },
      title: 'T',
    });
  });

  await page.waitForTimeout(8000);
  const dump = await page.evaluate(() => {
    const r = document.querySelector('.sn-popup');
    return r ? r.innerText : 'NO POPUP';
  });
  const called = await app.evaluate(() => globalThis.__called);
  console.log('=== CALLED:', called);
  console.log('=== DUMP:', JSON.stringify(dump));
  console.log('=== CONSOLE:', errs.slice(0, 20).join('\n'));
  expect(1).toBe(1);
});
