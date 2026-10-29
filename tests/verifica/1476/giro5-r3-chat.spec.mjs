// Verifica #1476 giro 5, rilievo 3: una scheda chiusa e già riaperta da un'altra strada non torna con Ctrl/Cmd+Shift+T.
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


test('r3 una scheda chiusa e riaperta dalla chat non torna di nuovo con Ctrl+Shift+T', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const prima = testServer.html('<title>Prima</title><h1>p</h1>', { pubblico: true });
  const ricetta = testServer.html('<title>Ricetta</title><h1>r</h1>', { pubblico: true });
  await apriEAspetta(app, prima);
  await premi(app, 'W', ['control']);
  await apriEAspetta(app, ricetta);
  await premi(app, 'W', ['control']);
  await expect.poll(() => info(app).then((i) => i.urls.includes(ricetta) || i.urls.includes(prima)), { timeout: 10_000 }).toBe(false);
  await sleep(800);
  const r = await app.evaluate((_e, u) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url: u, label: 'Ricetta' }), ricetta);
  expect(r.executed).toBe(true);
  await expect.poll(() => info(app).then((i) => i.urls.filter((u) => u === ricetta).length), { timeout: 10_000 }).toBe(1);
  const n = (await info(app)).count;
  await premi(app, 'T', ['control', 'shift']);
  await expect.poll(() => info(app).then((i) => i.count), { timeout: 10_000 }).toBe(n + 1);
  expect((await info(app)).urls.filter((u) => u === ricetta).length, JSON.stringify(await info(app))).toBe(1);
  expect((await info(app)).urls).toContain(prima);
});
