// Regression test per il feedback "non vedo la parola suggerita" sulla newtab.
//
// Bug: openNormalMenuAt() fa `await getClipboardHistory()` PRIMA di registrare
// il waiter `onNextNativeSuggestion`. Il broadcast `_spell:native` dal main
// arrivava in mezzo all'await: il waiter veniva registrato dopo che
// `lastNative` era già stato aggiornato, ma onNextNativeSuggestion ascoltava
// solo broadcast futuri, quindi perdeva il suggerimento e l'item di
// correzione restava nascosto.
//
// Fix: onNextNativeSuggestion accetta { since: ts } e se lastNative è arrivato
// dopo quell'istante lo consegna subito. Qui verifichiamo il fix simulando
// l'arrivo "in anticipo" del broadcast.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test('onNextNativeSuggestion consegna lastNative arrivato durante await', async ({ app }) => {
  const page = await newtabPage(app);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1' &&
          typeof globalThis.SN_SPELLCHECK?.onNextNativeSuggestion === 'function',
    null,
    { timeout: 8_000 },
  );

  const result = await page.evaluate(async () => {
    const openedAt = Date.now();
    // Simula l'arrivo "in mezzo all'await" del broadcast nativo: prima
    // facciamo finta che sia arrivato (chrome.runtime.onMessage listener
    // popola lastNative), poi registriamo il waiter passando since=openedAt.
    const listeners = globalThis.chrome.runtime.onMessage._listeners;
    for (const fn of listeners) {
      try { fn({ type: '_spell:native', word: 'recieve', suggestions: ['receive', 'reverse', 'received'] }); } catch (_) {}
    }
    // Piccola attesa per simulare il completamento dell'await.
    await new Promise((r) => setTimeout(r, 30));
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: true }), 1000);
      SN_SPELLCHECK.onNextNativeSuggestion(({ word, suggestions }) => {
        clearTimeout(timer);
        resolve({ word, suggestions });
      }, { since: openedAt });
    });
  });

  expect(result.timedOut).toBeFalsy();
  expect(result.word).toBe('recieve');
  expect(result.suggestions[0]).toBe('receive');
});

test('onNextNativeSuggestion ignora lastNative precedente al since', async ({ app }) => {
  const page = await newtabPage(app);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1' &&
          typeof globalThis.SN_SPELLCHECK?.onNextNativeSuggestion === 'function',
    null,
    { timeout: 8_000 },
  );

  const result = await page.evaluate(async () => {
    // Simula un broadcast di un right-click "vecchio" (3s fa).
    const listeners = globalThis.chrome.runtime.onMessage._listeners;
    for (const fn of listeners) {
      try { fn({ type: '_spell:native', word: 'old', suggestions: ['older'] }); } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 50));
    const openedAt = Date.now(); // nuovo right-click ADESSO, dopo il broadcast
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: true }), 300);
      SN_SPELLCHECK.onNextNativeSuggestion(({ word }) => {
        clearTimeout(timer);
        resolve({ word });
      }, { since: openedAt, timeoutMs: 250 });
    });
  });

  // Deve scadere in timeout: il broadcast vecchio non va consumato.
  expect(result.timedOut).toBeTruthy();
});
