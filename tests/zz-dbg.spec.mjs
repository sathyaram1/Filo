import { test, expect } from './fixtures/electron.mjs';
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
test('la descrizione delle immagini non ripiega su un modello scritto nel codice', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await shell.waitForLoadState('domcontentloaded');
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => typeof window.SN_ACTIONS?.requestImageDescription === 'function',
    null, { timeout: 10_000 },
  );

  // Spia lato main: registra OGNI modello realmente chiamato.
  const setup = async (modelsForImage, failAll) => app.evaluate(async ({ modelsForImage, failAll }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { mio: { provider: 'openrouter', model: 'test/modello-uno' } },
      models: { [C.ACTIONS.DESCRIBE_IMAGE]: modelsForImage },
    });
    globalThis.__called = [];
    globalThis.__failAll = failAll;
    if (!globalThis.__origComplete) {
      globalThis.__origComplete = globalThis.SN_PROVIDERS.completeWithFallback;
      globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
        for (const a of attempts) {
          globalThis.__called.push(a.model);
          if (globalThis.__failAll) continue;
          return { text: 'un gatto sul divano', model: a.model, provider: a.provider, usage: {} };
        }
        throw new Error('il modello configurato non risponde');
      };
    }
  }, { modelsForImage, failAll });

  const calledModels = () => app.evaluate(() => globalThis.__called.slice());

  // La funzione del content script, chiamata come la chiama Filo quando copi
  // un'immagine: prima la voce entra in cronologia, poi parte la descrizione.
  const run = async (dataUrl) => page.evaluate(async (url) => {
    window.__toasts = [];
    if (!window.SN_POPUP.__origToast) {
      window.SN_POPUP.__origToast = window.SN_POPUP.showToast;
      window.SN_POPUP.showToast = (t) => { window.__toasts.push(String(t)); };
    }
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.PUSH_CLIPBOARD_ENTRY,
      entry: { type: 'image', dataUrl: url, description: 'Descrizione…' },
    });
    const desc = await window.SN_ACTIONS.requestImageDescription(url);
    const hist = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY });
    const entry = (hist?.items || []).find((x) => x.dataUrl === url);
    return { desc, toasts: window.__toasts.slice(), entryDescription: entry?.description || null };
  }, dataUrl);

  // 1. Configurata bene: la descrizione arriva, e dal modello scelto.
  await setup('mio', false);
  const ok = await run(PNG_1X1 + '#a');
  console.log('OK', JSON.stringify(ok));
  expect(ok.desc).toBe('un gatto sul divano');
  expect(await calledModels()).toEqual(['test/modello-uno']);
  expect(ok.entryDescription).toBe('un gatto sul divano');

  // 2. Nessun modello impostato: NIENTE descrizione, nessun modello chiamato,
  //    e l'utente lo viene a sapere.
  await setup('', false);
  const senza = await run(PNG_1X1 + '#b');
  expect(senza.desc).toBe(null);
  expect(await calledModels(), 'nessun modello deve essere chiamato').toEqual([]);
  const label = await app.evaluate(() => globalThis.SN_CONST.actionLabel(globalThis.SN_CONST.ACTIONS.DESCRIBE_IMAGE));
  expect(senza.toasts.join(' | ')).toContain(label);
  expect(senza.toasts.join(' | ')).toMatch(/Opzioni/i);
  expect(senza.entryDescription).not.toBe('Descrizione…');

  // 3. Configurata bene ma il modello fallisce: si prova SOLO il configurato.
  await setup('mio', true);
  const rotto = await run(PNG_1X1 + '#c');
  expect(rotto.desc).toBe(null);
  expect(await calledModels()).toEqual(['test/modello-uno']);
});
