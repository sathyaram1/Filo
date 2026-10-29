// Verifica #1476 giro 5, rilievo 2: Ctrl/Cmd+Shift+T si conta fra le schede riaperte, non fra quelle trascinate.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function info(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs;
    const a = t.tabs.find((x) => x.id === t.activeId) || null;
    return { urls: t.tabs.map((x) => x.url), count: t.tabs.length, activeId: t.activeId, activeUrl: a ? a.url : null };
  });
}

function premi(app, keyCode, modifiers, volte = 1) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers, volte }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    for (let i = 0; i < volte; i++) {
      t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    }
  }, { keyCode, modifiers, volte });
}

function apriEAspetta(app, url) {
  return app.evaluate(async ({ BrowserWindow }, url) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const id = tm.openTab(url);
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000) {
      const tab = tm.tabs.find((t) => t.id === id);
      if (tab && tab.url === url && !tab.loading) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return id;
  }, url);
}

const contatori = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = { schedaTrascinata: 0, riaperte: 0 };
  for (const [k, o] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    out.schedaTrascinata += Object.values((o.finestra && o.finestra.schedaTrascinata) || {}).reduce((a, n) => a + n, 0);
    out.riaperte += Object.values(o.riaperte || {}).reduce((a, n) => a + n, 0);
  }
  return out;
});

test('r2 una riapertura con Ctrl+Shift+T è una riaperta, non una scheda trascinata', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const a = testServer.html('<title>A</title><h1>A</h1>', { pubblico: true });
  const b = testServer.html('<title>B</title><h1>B</h1>', { pubblico: true });
  const c = testServer.html('<title>C</title><h1>C</h1>', { pubblico: true });
  await apriEAspetta(app, a);
  const idB = await apriEAspetta(app, b);
  await apriEAspetta(app, c);
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activate(id);
  }, idB);
  await premi(app, 'W', ['control']);
  await expect.poll(() => info(app).then((i) => i.urls.includes(b)), { timeout: 10_000 }).toBe(false);
  await sleep(1500);
  const prima = await contatori(app);

  await premi(app, 'T', ['control', 'shift']);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(b);
  await sleep(1500);
  const dopo = await contatori(app);
  expect.soft(dopo.schedaTrascinata, 'nessuno ha trascinato una scheda').toBe(prima.schedaTrascinata);
  expect(dopo.riaperte, 'la scheda chiusa è stata riaperta').toBe(prima.riaperte + 1);
});
