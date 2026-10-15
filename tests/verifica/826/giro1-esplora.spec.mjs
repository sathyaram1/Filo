// #826 giro 1 — esplorazione: pagina interna, navigazione nella stessa scheda, secondo turno.

import { test, expect } from '../../helpers/reteFinta.mjs';

const PAGINA_A = '<title>Pagina A</title><body style="padding:40px;font:16px sans-serif"><h1>Articolo A</h1><a id="vai" href="/b">vai</a></body>';
const PAGINA_B = '<title>Pagina B</title><body style="padding:40px;font:16px sans-serif"><h1>Articolo B</h1></body>';

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function aiutoFinto(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const risposta = ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: '{"message":"Ciao.","suggestions":[],"issues":[]}' };
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      return { ...base, text: JSON.stringify({ text: 'Ok, risposta finta.', status: 'done' }) };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  });
}

async function apri(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url() === url) || null; return !!page; }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  return page;
}

const sistemi = async (app) => (await app.evaluate(() => globalThis.__visti)).map((ms) => String((ms.find((m) => m.role === 'system') || {}).content || ''));

async function chiedi(page, testo) {
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await page.fill('.sn-sidebar-input textarea', testo);
  await page.press('.sn-sidebar-input textarea', 'Enter');
}

test('pagina interna: Aiuto dal menu della scheda porta la data', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const url = 'filo://history/history.html';
  const page = await apri(app, shell, url);
  await preparaModelli(app);
  await aiutoFinto(app);
  const id = await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((t) => t.url === u).id, url);
  await shell.evaluate((i) => window.filoShell.tabs.help(i), id);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await chiedi(page, 'quando l\'ho aperta?');
  await expect.poll(async () => (await sistemi(app)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect((await sistemi(app))[0]).toContain("l'utente l'ha aperta");
});

test('navigazione nella stessa scheda e secondo turno', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const urlA = rete.pagina('example.org', '/a', PAGINA_A);
  const urlB = rete.pagina('example.org', '/b', PAGINA_B);
  const pageA = await apri(app, shell, urlA);
  await preparaModelli(app);
  const due = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const id = await app.evaluate(({ BrowserWindow }, args) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.url === args.u);
    t.openedAt = args.due; return t.id;
  }, { u: urlA, due });
  await pageA.click('#vai');
  let pageB = null;
  await expect.poll(() => { pageB = app.windows().find((w) => w.url() === urlB) || null; return !!pageB; }, { timeout: 10_000 }).toBe(true);
  await pageB.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  await aiutoFinto(app);
  await shell.evaluate((i) => window.filoShell.tabs.help(i), id);
  await expect(pageB.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await chiedi(pageB, 'quando ho aperto questa pagina?');
  await expect.poll(async () => (await sistemi(app)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const s1 = (await sistemi(app))[0];
  console.log('RIGA', (s1.match(/Questa scheda.*\n/) || [''])[0]);
  await chiedi(pageB, 'e adesso?');
  await expect.poll(async () => (await sistemi(app)).length, { timeout: 15_000 }).toBeGreaterThan(1);
  const s2 = (await sistemi(app))[1];
  expect(s2).toContain("l'utente l'ha aperta 2 ore fa");
  console.log('SISTEMA1', s1.slice(s1.indexOf('# Contesto della pagina'), s1.indexOf('# Contesto della pagina') + 700));
});
