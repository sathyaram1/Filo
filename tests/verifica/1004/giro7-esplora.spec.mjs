// #1004 giro 7 — esplorazione: aspetto di Sicurezza e immagine incollata col menu di Filo.

import { test, expect } from '../../fixtures/electron.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('Sicurezza chiara e scura', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, '<!doctype html><title>Accesso</title><body><form><input type="password"></form></body>', { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  const s = await openTab('filo://security/security.html');
  await expect(s.locator('#sec-delicate')).toBeChecked({ timeout: 8000 });
  await expect(s.locator('#sec-delicate-campi-list li').first()).toBeVisible({ timeout: 8000 });
  await s.locator('#sec-delicate').scrollIntoViewIfNeeded();
  await s.screenshot({ path: 'tests/.shots/1004-g7-sicurezza-chiara.png' });
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await s.waitForTimeout(800);
  await s.locator('#sec-delicate').scrollIntoViewIfNeeded();
  await s.screenshot({ path: 'tests/.shots/1004-g7-sicurezza-scura.png' });
});

test('un\'immagine incollata col menu di Filo su un altro sito parte verso il modello delle immagini', async ({ app, openTab, testServer }) => {
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
  // L'immagine copiata (uno screenshot della banca) è negli appunti.
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
  console.log('immagini incollate', r);
  await expect.poll(() => app.evaluate(() => globalThis.__img), { timeout: 6000 }).toBeGreaterThan(0);
});
