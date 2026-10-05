// #1004 giro 7 r1 — lo screenshot di una pagina delicata, incollato col menu di Filo su un altro sito, non va al modello.

import { test, expect } from '../../fixtures/electron.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('lo screenshot della banca incollato col menu di Filo in un altro sito non parte verso il modello delle immagini', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__img = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      if (JSON.stringify(messages).includes('image_url')) globalThis.__img++;
      return { text: 'Contabile del bonifico', provider: 'openrouter', model: 'stub', usage: {} };
    };
  });
  // Lo screenshot della pagina della banca: Filo non lo descrive, ed è negli appunti.
  await testServer.openReady(openTab, '<!doctype html><title>Il mio conto</title><body><p>Saldo 12.345</p><form><input type="password"></form></body>', { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  const daBanca = await app.evaluate(async ({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const tab = tm.tabs.find((t) => t.title === 'Il mio conto');
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `SN_ACTIONS.requestImageDescription(${JSON.stringify(u)})` }], true);
  }, PNG);
  expect(daBanca).toBe(null);
  expect(await app.evaluate(() => globalThis.__img)).toBe(0);
  await app.evaluate(({ clipboard, nativeImage }, u) => clipboard.writeImage(nativeImage.createFromDataURL(u)), PNG);
  await testServer.openReady(openTab, '<!doctype html><title>Chat</title><body><div id="m" contenteditable="true">x</div></body>');
  const r = await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const tab = tm.tabs.find((t) => t.title === 'Chat');
    tab.view.webContents.focus();
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `(async () => {
      const el = document.getElementById('m'); el.focus();
      SN_ACTIONS.init({ getPasteContext: () => ({ kind: 'ce', el }), restorePasteContext: () => {} });
      await SN_ACTIONS.pasteFromClipboard();
      return document.querySelectorAll('#m img').length;
    })()` }], true);
  });
  expect(r, 'l\'immagine è incollata').toBe(1);
  // Incollata nella chat di un altro sito, la stessa immagine della banca non deve partire verso il modello.
  await new Promise((ok) => setTimeout(ok, 3000));
  expect(await app.evaluate(() => globalThis.__img)).toBe(0);
});
