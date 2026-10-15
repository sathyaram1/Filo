// #826 giro 1, rilievo 1 — la scheda aperta da ore, la pagina che mostra arrivata adesso con un clic:
// l'Aiuto deve sapere anche da quanto c'è la pagina, non solo da quanto c'è la scheda.

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
      globalThis.__visti.push(sistema);
      return { ...base, text: JSON.stringify({ text: 'Ok.', status: 'done' }) };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  });
}

async function attendiPagina(app, url) {
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url() === url) || null; return !!page; }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  return page;
}

test('r1 scheda aperta da due ore, pagina raggiunta adesso nella stessa scheda: l\'Aiuto sa che la pagina è appena arrivata', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const urlA = rete.pagina('example.org', '/a', PAGINA_A);
  const urlB = rete.pagina('example.org', '/b', PAGINA_B);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), urlA);
  const pageA = await attendiPagina(app, urlA);
  await preparaModelli(app);
  const id = await app.evaluate(({ BrowserWindow }, args) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.url === args.u);
    t.openedAt = args.due;
    return t.id;
  }, { u: urlA, due: new Date(Date.now() - 2 * 3600 * 1000).toISOString() });

  await pageA.click('#vai');
  const pageB = await attendiPagina(app, urlB);
  await aiutoFinto(app);
  await shell.evaluate((i) => window.filoShell.tabs.help(i), id);
  await expect(pageB.locator('.sn-sidebar[data-invoked-from="tab"]')).toBeVisible({ timeout: 8_000 });
  await pageB.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await pageB.fill('.sn-sidebar-input textarea', 'quando ho aperto questa pagina?');
  await pageB.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(async () => (await app.evaluate(() => globalThis.__visti)).length, { timeout: 15_000 }).toBeGreaterThan(0);

  const sistema = (await app.evaluate(() => globalThis.__visti))[0];
  expect(sistema).toContain("l'utente l'ha aperta 2 ore fa");
  // La pagina in vista è arrivata meno di un minuto fa: il modello deve poterlo dire.
  expect(sistema).toMatch(/meno di un minuto/);
});
