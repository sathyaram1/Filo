// #826 — L'Aiuto aperto dal menu di una scheda sa quando la scheda è stata aperta, e non manda l'elenco delle altre.
// La data la mette il main, anche dopo un riavvio di Filo; quella che manda la pagina non conta.
// Senza il lavoro al modello non arriva nessuna data, e la risposta finta resta senza ora.

import { test, expect } from './helpers/reteFinta.mjs';
import { nelMondoDiFilo } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const PAGINA_A = '<title>Pagina A</title><body style="padding:40px;font:16px sans-serif"><h1>Articolo A</h1></body>';
const PAGINA_B = '<title>Pagina B sorella</title><body style="padding:40px;font:16px sans-serif"><h1>Articolo B</h1></body>';
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

// Il modello finto dell'Aiuto ripete l'ora di apertura che legge nel contesto; le chiamate dell'Aiuto restano in __visti.
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
      const text = m ? `L'hai aperta ${m[1]}(${m[2]}).` : 'Non so quando l\'hai aperta.';
      return { ...base, text: JSON.stringify({ text, status: 'done' }) };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  }, RE_APERTURA.source);
}

async function apri(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url() === url) || null; return !!page; }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  return page;
}

const schedaDi = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => x.url === u);
  return t ? { id: t.id, openedAt: t.openedAt, quando: globalThis.SN_FILO_CONTESTO.quando(Date.parse(t.openedAt)) } : null;
}, url);

async function chiedi(page, testo) {
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await page.fill('.sn-sidebar-input textarea', testo);
  await page.press('.sn-sidebar-input textarea', 'Enter');
}

const testoDi = (messaggi) => (messaggi || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

test('Aiuto dal menu della scheda: il primo messaggio porta la data di apertura e nessuna altra scheda', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const urlA = rete.pagina('example.org', '/a', PAGINA_A);
  const urlB = rete.pagina('example.org', '/b', PAGINA_B);
  const pageA = await apri(app, shell, urlA);
  await apri(app, shell, urlB);
  await preparaModelli(app);
  await aiutoFinto(app);

  const a = await schedaDi(app, urlA);
  expect(a && a.quando).toBeTruthy();
  await shell.evaluate((id) => window.filoShell.tabs.help(id), a.id);
  await expect(pageA.locator('.sn-sidebar[data-invoked-from="tab"]')).toBeVisible({ timeout: 8_000 });
  await chiedi(pageA, 'quando l\'ho aperta?');

  // L'utente legge l'ora vera di apertura nella risposta.
  await expect(pageA.locator('.sn-sidebar-msg-assistant').last()).toContainText(`(${a.quando})`, { timeout: 15_000 });

  const primo = testoDi((await app.evaluate(() => globalThis.__visti))[0]);
  expect(primo).toMatch(new RegExp(`l'utente l'ha aperta (meno di un minuto|\\d+ minut[oi]) fa \\(${a.quando.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  expect(primo).toContain('Adesso è ');
  // L'elenco delle altre schede non esce: né l'indirizzo né il titolo dell'altra pagina dello stesso sito.
  expect(primo).not.toContain('example.org/b');
  expect(primo).not.toContain('Pagina B sorella');
});

test('dal menu della pagina c\'è la stessa data, e quella scritta dalla pagina non conta', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const urlA = rete.pagina('example.org', '/a', PAGINA_A);
  const pageA = await apri(app, shell, urlA);
  await preparaModelli(app);
  await aiutoFinto(app);
  const a = await schedaDi(app, urlA);

  // Il mondo dell'Aiuto prova a dire al main un'altra data di apertura.
  await nelMondoDiFilo(app, pageA, () => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'ai_request' && msg.payload) msg.payload.schedaApertaIl = '2001-01-01T08:00:00.000Z';
      return orig(msg, ...rest);
    };
  });

  await pageA.locator('h1').click({ button: 'right' });
  await expect(menuDi(pageA).locator('.sn-menu')).toBeVisible({ timeout: 8_000 });
  await menuDi(pageA).locator('.sn-menu').getByText('Aiuto', { exact: true }).click();
  await expect(pageA.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await chiedi(pageA, 'da quanto è aperta questa scheda?');

  await expect(pageA.locator('.sn-sidebar-msg-assistant').last()).toContainText(`(${a.quando})`, { timeout: 15_000 });
  const primo = testoDi((await app.evaluate(() => globalThis.__visti))[0]);
  expect(primo).not.toContain('2001');
});

test('dopo un riavvio la scheda ricorda quando era stata aperta', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const urlA = rete.pagina('example.org', '/a', PAGINA_A);
  await preparaModelli(app);
  const ieri = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  const treOre = new Date(Date.now() - 3 * 3600 * 1000).toISOString();

  // La sessione salvata da un Filo precedente: la scheda era aperta da ieri.
  await app.evaluate(async ({ BrowserWindow }, args) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    await globalThis.SN_STORAGE.setRaw(tm._sessionKey(), { tabs: [args.url], colors: [null], aperte: [args.ieri], pagine: [args.treOre], activeIndex: 0 });
    await tm.restoreSession();
  }, { url: urlA, ieri, treOre });

  const a = await schedaDi(app, urlA);
  expect(a.openedAt).toBe(ieri);
  // E torna nella sessione che si salva, per il riavvio dopo.
  const salvata = await app.evaluate(({ BrowserWindow }, u) => {
    const s = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.sessionState();
    return { aperta: s.aperte[s.tabs.indexOf(u)], pagina: s.pagine[s.tabs.indexOf(u)] };
  }, urlA);
  expect(salvata).toEqual({ aperta: ieri, pagina: treOre });

  let pageA = null;
  await expect.poll(() => { pageA = app.windows().find((w) => w.url() === urlA) || null; return !!pageA; }, { timeout: 10_000 }).toBe(true);
  await pageA.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  await aiutoFinto(app);
  await shell.evaluate((id) => window.filoShell.tabs.help(id), a.id);
  await expect(pageA.locator('.sn-sidebar[data-invoked-from="tab"]')).toBeVisible({ timeout: 8_000 });
  await chiedi(pageA, 'quando l\'ho aperta?');

  await expect(pageA.locator('.sn-sidebar-msg-assistant').last()).toContainText(`1 giorno e 2 ore fa (${a.quando})`, { timeout: 15_000 });
  // La pagina che la scheda mostrava prima del riavvio c'era da tre ore, non da adesso.
  expect(testoDi((await app.evaluate(() => globalThis.__visti))[0])).toContain('La pagina che mostra adesso ci è arrivata dopo, 3 ore fa');
});

test('scheda aperta da due ore, pagina raggiunta adesso con un collegamento: l\'Aiuto sa che la pagina è appena arrivata', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const urlA = rete.pagina('example.org', '/a', PAGINA_A.replace('</h1>', '</h1><a id="vai" href="/b">vai</a>'));
  const urlB = rete.pagina('example.org', '/b', PAGINA_B);
  const pageA = await apri(app, shell, urlA);
  await preparaModelli(app);
  const due = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const id = await app.evaluate(({ BrowserWindow }, args) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((x) => x.url === args.u);
    t.openedAt = args.due;
    return t.id;
  }, { u: urlA, due });

  await pageA.click('#vai');
  let pageB = null;
  await expect.poll(() => { pageB = app.windows().find((w) => w.url() === urlB) || null; return !!pageB; }, { timeout: 10_000 }).toBe(true);
  await pageB.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  await aiutoFinto(app);
  await shell.evaluate((i) => window.filoShell.tabs.help(i), id);
  await expect(pageB.locator('.sn-sidebar[data-invoked-from="tab"]')).toBeVisible({ timeout: 8_000 });
  await chiedi(pageB, 'quando ho aperto questa pagina?');
  await expect.poll(async () => (await app.evaluate(() => globalThis.__visti)).length, { timeout: 15_000 }).toBeGreaterThan(0);

  const primo = testoDi((await app.evaluate(() => globalThis.__visti))[0]);
  expect(primo).toContain("l'utente l'ha aperta 2 ore fa");
  expect(primo).toContain('La pagina che mostra adesso ci è arrivata dopo, meno di un minuto fa');
});
