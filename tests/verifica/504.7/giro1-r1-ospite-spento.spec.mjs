// Verifica #504.7 giro 1: sulla pagina di un sito dove l'utente ha spento Filo, Alt+T premuto dopo un clic nel riquadro
// incorporato (un video) non deve tradurre la pagina: lì Filo è spento, come per l'icona e per la chat.
import { test, expect } from '../../fixtures/electron.mjs';

const RIQUADRO = `<!doctype html><html lang="en"><body style="margin:0;padding:16px;font:16px sans-serif">
  <button id="play">Play video</button> <span id="w">Comments are closed</span>
</body></html>`;
const conRiquadro = (src) => `<!doctype html><html lang="en"><head><title>Private bank page</title></head>
<body style="font:16px sans-serif;padding:20px">
  <h1 id="head">Your account statement for this month</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up.</p>
  <iframe id="embed" src="${src}" width="420" height="120" style="border:1px solid #333"></iframe>
</body></html>`;

async function fornitoreFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoChiamate = 0;
    const prima = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return prima(args);
      globalThis.__filoChiamate++;
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const parti = (i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '').split(/\n?@@@SN_SEP@@@\n?/);
      return { text: parti.map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 'test-translate', usage: {} };
    };
  });
}

const premiAltT = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
  const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['alt'] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['alt'] });
});

for (const [come, pubblico] of [['dello stesso sito', false], ['di un altro sito', true]]) {
  test(`r1 pagina di un sito spento, clic nel riquadro ${come}, Alt+T: la pagina resta com'è e niente va al modello`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await fornitoreFinto(app);
    const host = new URL(testServer.origin).hostname;
    await app.evaluate(async (_e, host) => { await globalThis.SN_STORAGE.updateSettings({ blocklist: [host] }); }, host);
    const page = await testServer.openReady(openTab, conRiquadro(testServer.html(RIQUADRO, { pubblico })));
    const riquadro = page.frameLocator('#embed');
    await riquadro.locator('#play').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => getSelection().removeAllRanges());
    await premiAltT(app);
    await page.waitForTimeout(4000);
    await expect(page.locator('#head')).toHaveText('Your account statement for this month');
    expect(await page.evaluate(() => document.querySelectorAll('[data-sn-translated="1"]').length)).toBe(0);
    expect(await app.evaluate(() => globalThis.__filoChiamate)).toBe(0);
  });
}
