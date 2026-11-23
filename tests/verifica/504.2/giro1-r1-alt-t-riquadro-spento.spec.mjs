// #504.2 giro 1, rilievo 1 — Alt+T senza selezione dopo un clic in un riquadro di un sito dove l'utente ha spento Filo
// (il video di un sito spento, su una pagina dove Filo è acceso): la pagina che lo ospita deve tradursi lo stesso.

import { test, expect } from '../../fixtures/electron.mjs';

const INNER = `<!doctype html><html lang="en"><body style="margin:0;padding:16px;font:16px sans-serif">
  <button id="play">Play video</button>
</body></html>`;

const outer = (src) => `<!doctype html><html lang="en"><head><title>Football era</title></head>
<body style="font:16px sans-serif;padding:20px">
  <h1 id="title">The end of an era in European football</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up.</p>
  <iframe id="embed" src="${src}" width="440" height="160" style="border:1px solid #333"></iframe>
</body></html>`;

async function fornitore(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      // Filo spento sul sito del video, acceso sulla pagina che lo incorpora.
      blocklist: ['sito-pubblico.test'],
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

// Il tasto come lo manda il sistema: quelli sintetici di Playwright non passano dalle scorciatoie di Filo.
const premiAltT = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
  const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['alt'] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['alt'] });
});

test('r1 Alt+T dopo un clic nel video di un sito dove Filo è spento traduce la pagina che lo ospita', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitore(app);
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER, { pubblico: true })));
  await page.frameLocator('#embed').locator('#play').click();
  await page.waitForTimeout(500);
  await page.evaluate(() => getSelection().removeAllRanges());
  await premiAltT(app);
  await expect(page.locator('#title')).toHaveText(/^IT /, { timeout: 20_000 });
  await expect(page.locator('#p1')).toHaveText(/^IT /);
});
