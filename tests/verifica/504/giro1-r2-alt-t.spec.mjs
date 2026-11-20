// #504 giro 1, rilievo 2 — la traduzione della pagina ha anche una scorciatoia: Alt+T senza nessun testo selezionato
// traduce la pagina invece di dire che manca la selezione (con una selezione resta la traduzione della selezione).

import { test, expect } from '../../fixtures/electron.mjs';

const ARTICLE = `<!doctype html><html lang="en"><head><title>Football era</title></head><body style="font:16px sans-serif;padding:20px">
  <h1 id="title">The end of an era in European football</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up.</p>
</body></html>`;

async function fornitore(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      return { text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 'test-translate', usage: {} };
    };
  });
}

test('r2 Alt+T senza selezione traduce la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitore(app);
  const page = await testServer.openReady(openTab, ARTICLE);
  await page.locator('#p1').click();
  await page.evaluate(() => window.getSelection().removeAllRanges());
  // Il tasto come lo manda il sistema: quelli sintetici di Playwright non passano dalle scorciatoie di Filo (giro 2).
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['alt'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['alt'] });
  });
  await expect(page.locator('#title')).toHaveText(/^IT /, { timeout: 20_000 });
  await expect(page.locator('#p1')).toHaveText(/^IT /);
});
