// Verifica #1476 giro 6, rilievo 1: i tasti toccati dal lavoro si misurano fra le azioni come Ctrl+T, da ogni strada.
import { test, expect } from '../../fixtures/electron.mjs';

const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, o] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    for (const [id, a] of Object.entries(o.azioni || {})) out[id] = (out[id] || 0) + ((a && a.n) || 0);
  }
  return out;
});

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

const urls = (app) => app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.map((t) => t.url));

test('r1 Ctrl+Shift+T e Ctrl+L dalla barra si misurano fra le azioni, come Ctrl+T', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const a = testServer.html('<title>A</title><h1>A</h1>', { pubblico: true });
  await apriEAspetta(app, a);
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    tm.closeTab(tm.tabs.find((t) => t.url === u).id);
  }, a);
  await expect.poll(() => urls(app).then((l) => l.includes(a)), { timeout: 10_000 }).toBe(false);

  await shell.keyboard.press('Control+t');
  await expect.poll(async () => (await oggi(app))['new-tab'] || 0, { timeout: 10_000 }).toBe(1);

  await shell.keyboard.press('Control+Shift+T');
  await expect.poll(() => urls(app).then((l) => l.includes(a)), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await oggi(app))['reopen-closed-tab'] || 0, {
    timeout: 10_000, message: 'la riapertura è un’azione misurata come la scheda nuova',
  }).toBe(1);

  const prima = (await oggi(app))['address-bar'] || 0;
  await shell.keyboard.press('Control+l');
  await expect.poll(async () => (await oggi(app))['address-bar'] || 0, {
    timeout: 10_000, message: 'Ctrl+L dalla barra si misura come prima del lavoro',
  }).toBe(prima + 1);
});
