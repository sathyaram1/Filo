// Verifica #1476 giro 2: esplorazione di Ctrl/Cmd+Shift+T sotto stress.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const GAP = Number(process.env.GAP || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function info(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const a = t.tabs.find((x) => x.id === t.activeId) || null;
    return { activeId: t.activeId, activeUrl: a ? a.url : null, urls: t.tabs.map((x) => x.url), count: t.tabs.length };
  });
}

function premi(app, keyCode, modifiers) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  }, { keyCode, modifiers });
}

// Due pressioni di fila, nello stesso giro del main: come chi preme due volte svelto.
function riapriDueVolte(app) {
  return app.evaluate(({ BrowserWindow }, GAP) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control', 'shift'] });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control', 'shift'] });
    return new Promise((r) => setTimeout(() => {
      const u = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
      u.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control', 'shift'] });
      r();
    }, GAP));
  }, GAP);
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

test('due pressioni svelte dopo un riavvio riaprono due schede diverse dall archivio', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const x = testServer.html('<title>X</title><h1>x</h1>');
  const y = testServer.html('<title>Y</title><h1>y</h1>');
  await app.evaluate(async (_e, { x, y }) => {
    await globalThis.SN_ARCHIVED_TABS.archive({ url: x, title: 'X', closedAt: '2026-10-01T10:00:00.000Z' });
    await globalThis.SN_ARCHIVED_TABS.archive({ url: y, title: 'Y', closedAt: '2026-10-02T10:00:00.000Z' });
  }, { x, y });
  const base = (await info(app)).count;
  await riapriDueVolte(app);
  await expect.poll(() => info(app).then((i) => i.count), { timeout: 10_000 }).toBe(base + 2);
  await sleep(800);
  const dopo = await info(app);
  expect(dopo.urls.filter((u) => u === y)).toHaveLength(1);
  expect(dopo.urls.filter((u) => u === x)).toHaveLength(1);
});

test('due schede chiuse in fretta tornano tutte e due, la più recente prima', async ({ app, shell, testServer }) => {
  await shell.waitForLoadState('domcontentloaded');
  const p = testServer.html('<title>P</title><h1>p</h1>');
  const q = testServer.html('<title>Q</title><h1>q</h1>');
  await apriEAspetta(app, p);
  await apriEAspetta(app, q);
  await premi(app, 'W', ['control']);
  await premi(app, 'W', ['control']);
  await expect.poll(() => info(app).then((i) => i.urls.some((u) => u === p || u === q)), { timeout: 10_000 }).toBe(false);
  await riapriDueVolte(app);
  await expect.poll(() => info(app).then((i) => [i.urls.includes(p), i.urls.includes(q)]), { timeout: 10_000 }).toEqual([true, true]);
  const dopo = await info(app);
  expect(dopo.activeUrl).toBe(q);
  expect(dopo.urls.indexOf(p)).toBeLessThan(dopo.urls.indexOf(q));
});

test('la scheda riaperta torna al punto dove si leggeva', async ({ app, openTab, testServer }) => {
  const lunga = testServer.html('<title>Lunga</title>' + Array.from({ length: 400 }, (_, i) => `<p id="p${i}">riga ${i}</p>`).join(''));
  const page = await openTab(lunga);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  await sleep(1500);
  const prima = await page.evaluate(() => window.scrollY);
  expect(prima).toBeGreaterThan(1000);
  await premi(app, 'W', ['control']);
  await expect.poll(() => info(app).then((i) => i.urls.includes(lunga)), { timeout: 10_000 }).toBe(false);
  await premi(app, 'T', ['control', 'shift']);
  await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(lunga);
  const { activeId } = await info(app);
  let pagina = null;
  await expect.poll(async () => Boolean(pagina = await paginaDellaScheda(app, activeId)), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => pagina.evaluate(() => window.scrollY), { timeout: 10_000 }).toBeGreaterThan(prima * 0.8);
});
