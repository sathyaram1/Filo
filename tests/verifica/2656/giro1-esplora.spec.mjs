// Verifica #2656 giro 1: il riquadro di un sito spento resta non tradotto anche annidato, da un sottodominio e
// arrivato dopo la traduzione. Fornitore finto come in traduci-pagina-chat.spec.mjs: antepone "IT ".

import { test, expect } from '../../fixtures/electron.mjs';

test.use({ hostInPiu: ['commenti.test', 'video.sito-pubblico.test'] });

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
    globalThis.__filoTesti = [];
    const prima = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return prima(args);
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const parti = (i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '').split(/\n?@@@SN_SEP@@@\n?/);
      globalThis.__filoTesti.push(...parti);
      return { text: parti.map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 'test-translate', usage: {} };
    };
  });
}
const spenti = (app, elenco) => app.evaluate(async (_e, elenco) => {
  await globalThis.SN_STORAGE.updateSettings({ blocklist: elenco });
}, elenco);
const testiPagati = (app) => app.evaluate(() => globalThis.__filoTesti.join(' || '));
const premiAltT = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
  const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['alt'] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['alt'] });
});
const traduci = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  return globalThis.SN_EXECUTE_FILO_ACTION({ type: 'TRADUCI_PAGINA' }, { sender: { win, wc: win.webContents, url: 'filo://newtab/' } });
});
const guardaAvvisi = (page) => page.evaluate(() => {
  window.__avvisi = [];
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__avvisi.push(n.textContent || '');
  }).observe(document.documentElement, { childList: true, subtree: true });
});
const avvisi = (page) => page.evaluate(() => (window.__avvisi || []).join(' | '));
const su = (testServer, host, url) => url.replace(testServer.origin, `http://${host}:${new URL(testServer.origin).port}`);

const SPENTO = `<!doctype html><html lang="en"><body style="margin:0;padding:12px;font:16px sans-serif">
  <span id="w">Comments are closed</span></body></html>`;
const MEZZO = (src) => `<!doctype html><html lang="en"><body style="margin:0;padding:12px;font:16px sans-serif">
  <span id="m">Latest comments from readers</span>
  <iframe id="nipote" src="${src}" width="320" height="70" style="border:0"></iframe></body></html>`;
const OSPITE = (src) => `<!doctype html><html lang="en"><head><title>Football era</title></head>
<body style="font:16px sans-serif;padding:20px">
  <h1 id="head">The end of an era in European football</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up.</p>
  ${src ? `<iframe id="embed" src="${src}" width="460" height="160" style="border:1px solid #333"></iframe>` : ''}
</body></html>`;

test('annidato: pagina accesa, riquadro acceso di un altro sito, dentro un riquadro del sito spento: quello resta com\'è', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await fornitoreFinto(app);
  await spenti(app, ['sito-pubblico.test']);
  const nipote = testServer.html(SPENTO, { pubblico: true });
  const mezzo = su(testServer, 'commenti.test', testServer.html(MEZZO(nipote)));
  const page = await testServer.openReady(openTab, OSPITE(mezzo));
  await guardaAvvisi(page);
  const r = page.frameLocator('#embed');
  await expect(r.frameLocator('#nipote').locator('#w')).toBeVisible({ timeout: 15_000 });
  await premiAltT(app);
  await expect(page.locator('#head')).toHaveText(/^IT /, { timeout: 30_000 });
  await expect(r.locator('#m')).toHaveText(/^IT Latest comments/, { timeout: 30_000 });
  await expect.poll(() => avvisi(page), { timeout: 15_000 }).toMatch(/sito-pubblico\.test/);
  await expect(r.frameLocator('#nipote').locator('#w')).toHaveText('Comments are closed');
  expect(await testiPagati(app)).not.toMatch(/Comments are closed/);
  await page.screenshot({ path: 'tests/.shots/verifica-2656-annidato.png' }).catch(() => {});
});

test('sottodominio: spento sito-pubblico.test, il riquadro di video.sito-pubblico.test resta com\'è', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitoreFinto(app);
  await spenti(app, ['sito-pubblico.test']);
  const src = su(testServer, 'video.sito-pubblico.test', testServer.html(SPENTO));
  const page = await testServer.openReady(openTab, OSPITE(src));
  await guardaAvvisi(page);
  await expect(page.frameLocator('#embed').locator('#w')).toBeVisible({ timeout: 15_000 });
  await premiAltT(app);
  await expect(page.locator('#head')).toHaveText(/^IT /, { timeout: 30_000 });
  await expect.poll(() => avvisi(page), { timeout: 15_000 }).toMatch(/sito-pubblico\.test/);
  await expect(page.frameLocator('#embed').locator('#w')).toHaveText('Comments are closed');
  expect(await testiPagati(app)).not.toMatch(/Comments are closed/);
});

test('arrivato dopo: la pagina è tradotta, poi il sito aggiunge un riquadro del sito spento; ritradotta, resta com\'è e Filo non insiste', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await fornitoreFinto(app);
  await spenti(app, ['sito-pubblico.test']);
  const page = await testServer.openReady(openTab, OSPITE(''));
  await traduci(app);
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30_000 });
  await expect.poll(async () => (await traduci(app)).output.traduzione, { timeout: 30_000 }).toBe('gia_tradotta');

  const src = testServer.html(SPENTO, { pubblico: true });
  await page.evaluate((src) => {
    const f = document.createElement('iframe');
    f.id = 'tardi'; f.src = src; f.width = '460'; f.height = '120';
    document.body.appendChild(f);
  }, src);
  await expect(page.frameLocator('#tardi').locator('#w')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800);
  // Chiesto più volte, la risposta si assesta su «già tradotta»: il riquadro spento non resta «testo nuovo» per sempre.
  await expect.poll(async () => (await traduci(app)).output.traduzione, { timeout: 30_000, intervals: [1500] }).toBe('gia_tradotta');
  await expect(page.frameLocator('#tardi').locator('#w')).toHaveText('Comments are closed');
  expect(await testiPagati(app)).not.toMatch(/Comments are closed/);
});
