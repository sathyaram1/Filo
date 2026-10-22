// Giro 4 di #1476, rilievo 1: dopo «chiudi tutto» le schede riaperte una a una tornano in un ordine diverso.
import { test, expect } from '../../fixtures/electron.mjs';

function urls(app) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.map((t) => t.url));
}

function premi(app, keyCode, modifiers) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  }, { keyCode, modifiers });
}

function apriEAspetta(app, url) {
  return app.evaluate(async ({ BrowserWindow }, url) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
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

test('r1 dopo chiudi tutto, Ctrl+Shift+T ripetuto rimette le schede nel loro ordine', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const [x, y, z] = ['X', 'Y', 'Z'].map((n) => testServer.html(`<title>${n}</title><h1>${n}</h1>`));
  for (const u of [x, y, z]) await apriEAspetta(app, u);
  // La porta dell'utente: «/clear all» scritto nella home.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.closeAllTabs();
  });
  await expect.poll(() => urls(app).then((u) => u.includes(z)), { timeout: 10_000 }).toBe(false);

  for (const atteso of [z, y, x]) {
    await premi(app, 'T', ['control', 'shift']);
    await expect.poll(() => urls(app).then((u) => u.includes(atteso)), { timeout: 10_000 }).toBe(true);
  }
  const fine = await urls(app);
  expect(fine.filter((u) => [x, y, z].includes(u))).toEqual([x, y, z]);
});
