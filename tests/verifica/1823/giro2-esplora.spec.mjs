// Esplorazione del giro 2 di #1823: le strade vere (tasto destro, scorciatoia, screenshot) verso i due modelli.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SEGRETO = 'Saldo disponibile 12.345,67 euro bonifico a Mario Rossi';

async function modelliFinti(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => ({ vectors: texts.map(() => [0.5, 0.2, 0.9, 0.1]) });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      globalThis.__mandato.push({ testo: JSON.stringify(messages) });
      return { text: '{"category":"Varie","confidence":0.9,"isNew":true}', provider: 'openrouter', model: 'stub', usage: {} };
    };
  });
}
const mandato = (app) => app.evaluate(() => globalThis.__mandato.slice());
const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };
const impostaDaFilo = (app, settings) => app.evaluate(async ({}, { s, da }) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: s }, da), { s: settings, da: DALLE_PREFERENZE });
const categorizzazioni = async (app) => (await mandato(app)).filter((m) => m.testo.includes('Categorizza'));
const salvate = (app) => app.evaluate(() => globalThis.SN_SAVED_PAGES.list());

async function salvaLinkDalMenu(page, sel) {
  await page.locator(sel).click({ button: 'right' });
  const menu = menuDi(page);
  const voce = menu.locator('.sn-menu-item', { hasText: 'Salva link per dopo' }).first();
  await expect(voce).toBeVisible({ timeout: 8000 });
  await voce.click();
}

test('link dal tasto destro su una pagina delicata: al modello solo il tipo', async ({ app, openTab, testServer }) => {
  await modelliFinti(app);
  await impostaDaFilo(app, { featureFlags: { categorize: true }, security: { pagineDelicate: { siti: ['sito-pubblico.test'] } } });
  const page = await testServer.openReady(openTab, `<!doctype html><title>Posta di Mario</title><body style="padding:40px">
    <p>${SEGRETO}</p><a id="l" href="https://reset.esempio-normale.org/pw?token=SEGRETOTOKEN">Conferma il bonifico di 3.000 euro a Mario Rossi</a></body>`, { pubblico: true });
  await salvaLinkDalMenu(page, '#l');
  await expect.poll(async () => (await salvate(app)).length, { timeout: 8000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await categorizzazioni(app)).length, { timeout: 8000 }).toBe(1);
  const [c] = await categorizzazioni(app);
  for (const s of ['SEGRETOTOKEN', 'esempio-normale', 'Mario Rossi', '3.000']) expect(c.testo).not.toContain(s);
  await expect.poll(async () => ((await salvate(app))[0] || {}).category || null, { timeout: 8000 }).toBe('Varie');
});

test('link dal tasto destro su una pagina della rete di casa: niente al modello', async ({ app, openTab, testServer }) => {
  await modelliFinti(app);
  await impostaDaFilo(app, { featureFlags: { categorize: true } });
  const page = await testServer.openReady(openTab, `<!doctype html><title>Router</title><body style="padding:40px">
    <a id="l" href="https://www.esempio-normale.org/firmware">Aggiornamento firmware del router di casa</a></body>`);
  await salvaLinkDalMenu(page, '#l');
  await expect.poll(async () => (await salvate(app)).length, { timeout: 8000 }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 2500));
  expect(await categorizzazioni(app)).toEqual([]);
});

test('link dal tasto destro su una pagina normale: titolo del link e indirizzo arrivano', async ({ app, openTab, testServer }) => {
  await modelliFinti(app);
  await impostaDaFilo(app, { featureFlags: { categorize: true } });
  const page = await testServer.openReady(openTab, `<!doctype html><title>Blog</title><body style="padding:40px">
    <a id="l" href="https://www.esempio-normale.org/ricetta">Ricetta del pane con lievito madre</a></body>`, { pubblico: true });
  await salvaLinkDalMenu(page, '#l');
  await expect.poll(async () => (await categorizzazioni(app)).length, { timeout: 8000 }).toBe(1);
  expect((await categorizzazioni(app))[0].testo).toContain('lievito madre');
});

test('scorciatoia Salva per dopo su una pagina delicata: al modello solo il tipo', async ({ app, openTab, testServer }) => {
  await modelliFinti(app);
  await impostaDaFilo(app, { featureFlags: { categorize: true }, security: { pagineDelicate: { siti: ['sito-pubblico.test'] } } });
  await testServer.openReady(openTab, `<!doctype html><title>Il mio conto 4471</title><body><p>${SEGRETO}</p></body>`, { pubblico: true });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tm = w._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    tab.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 's', modifiers: ['alt'] });
    tab.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 's', modifiers: ['alt'] });
  });
  await expect.poll(async () => (await salvate(app)).length, { timeout: 8000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await categorizzazioni(app)).length, { timeout: 8000 }).toBe(1);
  const [c] = await categorizzazioni(app);
  for (const s of ['4471', '12.345', 'sito-pubblico']) expect(c.testo).not.toContain(s);
});

test('screenshot dal tasto destro su una pagina delicata, nome automatico acceso: niente al modello dei nomi', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelliFinti(app);
  await impostaDaFilo(app, { nomiSensati: { scaricamenti: true }, security: { pagineDelicate: { siti: ['sito-pubblico.test'] } } });
  const page = await testServer.openReady(openTab, `<!doctype html><title>Il mio conto</title><body style="background:#fff;padding:40px"><h1>${SEGRETO}</h1></body>`, { pubblico: true });
  await page.mouse.click(5, 5);
  const primi = (await (await shell.evaluate(() => window.filoShell.downloads.list())).items || []).length;
  await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const tab = tm.tabs.find((t) => t.title === 'Il mio conto');
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: 'SN_ACTIONS.takeScreenshot()' }], true);
  });
  let rec = null;
  await expect.poll(async () => {
    const r = await shell.evaluate(() => window.filoShell.downloads.list());
    const items = (r && r.items) || [];
    rec = items.length > primi ? items[0] : null;
    return rec ? rec.state : null;
  }, { timeout: 30000 }).toBe('completed');
  await new Promise((r) => setTimeout(r, 4000));
  const m = await mandato(app);
  console.log('nome file', rec.filename, 'chiamate', m.map((x) => x.testo.slice(0, 120)));
  expect(m.filter((x) => x.testo.includes('image_url'))).toEqual([]);
});
