// Verifica #826 giro 2, rilievo 1: la scheda è aperta da due ore sulla stessa pagina, ma l'Aiuto dice al modello che la
// pagina in vista è appena arrivata: quando il sito riscrive l'indirizzo mentre la si legge, o tornando indietro alla prima.

import { test, expect } from '../../helpers/reteFinta.mjs';

const RE_APERTURA = /l'utente l'ha aperta (.*?)\(([^)]+)\)/;

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
  await app.evaluate((_e, sorgente) => {
    const re = new RegExp(sorgente);
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const risposta = ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: '{"message":"Ciao.","suggestions":[],"issues":[]}' };
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      const m = sistema.match(re);
      return { ...base, text: JSON.stringify({ text: m ? `L'hai aperta ${m[1]}.` : 'Non so.', status: 'done' }) };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  }, RE_APERTURA.source);
}

async function pronta(app, url) {
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url() === url) || null; return !!page; }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  return page;
}

// La scheda è nata due ore fa sulla pagina che mostra: nessun cambio di pagina da allora.
const invecchia = (app, url) => app.evaluate(({ BrowserWindow }, args) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.url === args.u);
  t.openedAt = args.due;
  t.paginaDal = null;
  return t.id;
}, { u: url, due: new Date(Date.now() - 2 * 3600 * 1000).toISOString() });

async function primoAlModello(app, shell, page, id) {
  await aiutoFinto(app);
  await shell.evaluate((i) => window.filoShell.tabs.help(i), id);
  await expect(page.locator('.sn-sidebar[data-invoked-from="tab"]')).toBeVisible({ timeout: 8_000 });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await page.fill('.sn-sidebar-input textarea', 'quando ho aperto questa pagina?');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(async () => (await app.evaluate(() => globalThis.__visti)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const m = (await app.evaluate(() => globalThis.__visti))[0];
  return m.map((x) => (typeof x.content === 'string' ? x.content : JSON.stringify(x.content))).join('\n');
}

test('r1 il sito riscrive l\'indirizzo mentre la si legge: la pagina c\'è ancora da due ore', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const url = rete.pagina('example.org', '/mappa', '<title>Mappa</title><body><h1>Mappa</h1><button id="sposta">sposta</button>'
    + '<script>document.getElementById("sposta").onclick=()=>history.replaceState(null,"","/mappa/@45,9,12z")</script></body>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const page = await pronta(app, url);
  await preparaModelli(app);
  const id = await invecchia(app, url);
  await page.click('#sposta');
  await expect.poll(() => page.url()).toContain('@45,9,12z');

  const primo = await primoAlModello(app, shell, page, id);
  expect(primo).toContain("l'utente l'ha aperta 2 ore fa");
  expect(primo).not.toContain('ci è arrivata dopo, meno di un minuto fa');
});

test('r1 tornando indietro alla prima pagina della scheda: è quella aperta due ore fa', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const urlA = rete.pagina('example.org', '/a', '<title>A</title><body><h1>A</h1><a id="vai" href="/b">vai</a></body>');
  const urlB = rete.pagina('example.org', '/b', '<title>B</title><body><h1>B</h1></body>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), urlA);
  const pageA = await pronta(app, urlA);
  await preparaModelli(app);
  const id = await invecchia(app, urlA);
  await pageA.click('#vai');
  await pronta(app, urlB);
  await shell.evaluate((i) => window.filoShell.tabs.back?.(i), id).catch(() => {});
  await app.evaluate(({ BrowserWindow }, i) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.id === i);
    if (t.view.webContents.getURL().endsWith('/b')) t.view.webContents.navigationHistory.goBack();
  }, id);
  const di = await pronta(app, urlA);

  const primo = await primoAlModello(app, shell, di, id);
  expect(primo).toContain("l'utente l'ha aperta 2 ore fa");
  expect(primo).not.toContain('ci è arrivata dopo, meno di un minuto fa');
});
