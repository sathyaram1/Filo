// Esplorazione #504.8: Alt+T dal riquadro di un sito acceso, dentro una pagina dove Filo è spento.
import { test, expect } from '../../fixtures/electron.mjs';

const RIQUADRO = `<!doctype html><html lang="en"><body style="margin:0;padding:16px;font:16px sans-serif">
  <button id="play">Play video</button> <span id="w">Comments are closed</span>
</body></html>`;
const conRiquadro = (src) => `<!doctype html><html lang="en"><head><title>Football era</title></head>
<body style="font:16px sans-serif;padding:20px">
  <h1 id="head">The end of an era in European football</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up.</p>
  <iframe id="embed" src="${src}" width="420" height="120" style="border:1px solid #333"></iframe>
</body></html>`;

const premiAltT = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
  const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['alt'] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['alt'] });
});

test('pagina spenta, riquadro acceso: Alt+T senza selezione non traduce la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [globalThis.SN_CONST.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
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
      const i = prompt.indexOf('<<<TESTO_IN_PAGINA>>>\n');
      const fine = prompt.lastIndexOf('\n<<<FINE_TESTO_IN_PAGINA>>>');
      const parti = (i >= 0 && fine > i ? prompt.slice(i + 22, fine) : '').split(/\n?@@@SN_SEP@@@\n?/);
      return { text: parti.map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 't', usage: {} };
    };
  });
  const host = new URL(testServer.origin).hostname;
  await app.evaluate(async (_e, host) => { await globalThis.SN_STORAGE.updateSettings({ blocklist: [host] }); }, host);
  const page = await testServer.openReady(openTab, conRiquadro(testServer.html(RIQUADRO, { pubblico: true })));
  const riquadro = page.frameLocator('#embed');
  await riquadro.locator('#play').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => getSelection().removeAllRanges());
  await premiAltT(app);
  await page.waitForTimeout(3000);
  await expect(page.locator('#head')).toHaveText('The end of an era in European football');
  expect(await app.evaluate(() => globalThis.__filoChiamate)).toBe(0);
});
