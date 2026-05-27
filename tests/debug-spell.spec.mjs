import { test, expect } from './fixtures/electron.mjs';

test('debug listeners 2', async ({ app }) => {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1' &&
          typeof globalThis.SN_SPELLCHECK?.onNextNativeSuggestion === 'function',
    null, { timeout: 8_000 }
  );

  const r = await win.evaluate(() => {
    const listeners = globalThis.chrome?.runtime?.onMessage?._listeners;
    const out = { 
      size: listeners ? listeners.size : -1,
      hasGetNative: typeof SN_SPELLCHECK.getNativeSuggestions === 'function',
    };
    // Before
    out.beforeNative = SN_SPELLCHECK.getNativeSuggestions('recieve');
    // Invoke
    for (const fn of listeners) {
      try {
        fn({ type: '_spell:native', word: 'recieve', suggestions: ['receive', 'reverse'] });
      } catch (e) { out.err = e.message; }
    }
    // After
    out.afterNative = SN_SPELLCHECK.getNativeSuggestions('recieve');
    return out;
  });
  console.log('DEBUG2:', JSON.stringify(r));
});
