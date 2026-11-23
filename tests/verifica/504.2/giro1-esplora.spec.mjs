// #504.2 giro 1 — esplorazione: Alt+T senza selezione da riquadri insoliti, e «apri … e traducilo» su un sito che
// cambia indirizzo appena aperto.

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

async function fornitore(app, extra = {}) {
  await app.evaluate(async (_e, extra) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      ...extra,
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
  }, extra);
}

const premiAltT = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
  const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['alt'] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['alt'] });
});

test('A Alt+T dopo un clic nel video di un sito dove Filo è spento traduce la pagina che lo ospita', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitore(app, { blocklist: ['sito-pubblico.test'] });
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER, { pubblico: true })));
  await page.frameLocator('#embed').locator('#play').click();
  await page.waitForTimeout(500);
  await page.evaluate(() => getSelection().removeAllRanges());
  await premiAltT(app);
  await expect(page.locator('#title')).toHaveText(/^IT /, { timeout: 20_000 });
});

test('B Alt+T dopo un clic in un riquadro dentro un riquadro traduce la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitore(app);
  const mezzo = `<!doctype html><html lang="en"><body style="margin:0;padding:4px"><iframe id="inner" src="${testServer.html(INNER)}" width="400" height="120"></iframe></body></html>`;
  const page = await testServer.openReady(openTab, outer(testServer.html(mezzo, { pubblico: true })));
  await page.frameLocator('#embed').frameLocator('#inner').locator('#play').click();
  await page.waitForTimeout(500);
  await premiAltT(app);
  await expect(page.locator('#title')).toHaveText(/^IT /, { timeout: 20_000 });
});

test('C Alt+T dopo un clic in un riquadro sandbox traduce la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitore(app);
  const html = outer(testServer.html(INNER, { pubblico: true })).replace('<iframe id="embed"', '<iframe id="embed" sandbox="allow-scripts"');
  const page = await testServer.openReady(openTab, html);
  await page.frameLocator('#embed').locator('#play').click();
  await page.waitForTimeout(500);
  await premiAltT(app);
  await expect(page.locator('#title')).toHaveText(/^IT /, { timeout: 20_000 });
});

const chiedi = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents, url: 'filo://newtab/' } });
  }, { action });

test('D «apri … e traducilo» su un sito che appena aperto passa a un altro indirizzo: la pagina finale si traduce', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  await fornitore(app);
  await expect(shell.locator('body')).toBeVisible();
  const finale = testServer.html(`<!doctype html><html lang="en"><head><title>Final</title></head><body style="padding:20px"><h1 id="head">The final English article</h1><p id="p1">Body of the final English article.</p></body></html>`);
  const inizio = testServer.html(`<!doctype html><html lang="en"><head><title>Redirecting</title></head><body><p>Redirecting you to the article now.</p><script>setTimeout(() => location.replace(${JSON.stringify(finale)}), 400)</script></body></html>`);
  const aperta = await chiedi(app, { type: 'NAVIGA', url: inizio });
  expect(aperta.executed).toBe(true);
  const r = await chiedi(app, { type: 'TRADUCI_PAGINA' });
  console.log('esito', JSON.stringify(r.output), r.executed);
  let page = null;
  await expect.poll(() => Boolean(page = app.windows().find((w) => w.url() === finale)), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('#head')).toHaveText(/^IT The final/, { timeout: 20_000 });
});
