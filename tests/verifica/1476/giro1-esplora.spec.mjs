// Verifica #1476 giro 1: Ctrl/Cmd+Shift+T riapre le schede chiuse, provato coi passi dell'utente.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function info(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const a = t.tabs.find((x) => x.id === t.activeId) || null;
    return { urls: t.tabs.map((x) => x.url), count: t.tabs.length, activeUrl: a ? a.url : null };
  });
}

function premiPiuVolte(app, volte) {
  return app.evaluate(({ BrowserWindow }, volte) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    for (let i = 0; i < volte; i++) {
      t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control', 'shift'] });
      t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control', 'shift'] });
    }
  }, volte);
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

test('Ctrl+Shift+T premuto due volte di fila dopo aver riaperto Filo riapre due schede diverse', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const urls = [];
  for (let i = 0; i < 4; i++) urls.push(testServer.html(`<title>Vecchia ${i}</title><h1>${i}</h1>`));
  await app.evaluate(async (_e, urls) => {
    for (let i = 0; i < urls.length; i++) {
      await globalThis.SN_ARCHIVED_TABS.archive({ url: urls[i], title: 'Vecchia ' + i, closedAt: `2026-10-0${i + 1}T10:00:00.000Z` });
    }
  }, urls);
  const base = (await info(app)).count;

  await premiPiuVolte(app, 2);
  await expect.poll(() => info(app).then((i) => i.count), { timeout: 10_000 }).toBe(base + 2);
  await sleep(800);
  const dopo = await info(app);
  const riaperte = dopo.urls.filter((u) => urls.includes(u));
  // Le due chiuse più di recente, una volta ciascuna.
  expect(riaperte.sort()).toEqual([urls[2], urls[3]].sort());
});

test('chiusa dalla x della linguetta, torna con Ctrl+Shift+T premuto dalla barra', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const sito = testServer.html('<title>Dalla x</title><h1>x</h1>');
  await apriEAspetta(app, sito);
  const tab = shell.locator('.tab', { hasText: 'Dalla x' });
  await expect(tab).toHaveCount(1, { timeout: 10_000 });
  await tab.hover();
  await tab.locator('.close').click();
  await expect.poll(() => info(app).then((i) => i.urls.includes(sito)), { timeout: 10_000 }).toBe(false);
  await shell.keyboard.press('Control+Shift+T');
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(sito);
});
