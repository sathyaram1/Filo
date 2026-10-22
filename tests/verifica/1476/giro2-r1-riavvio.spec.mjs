// Verifica #1476 giro 2, rilievo 1: una scheda già riaperta con Ctrl/Cmd+Shift+T non deve tornare di nuovo dopo un riavvio.
import { test, expect } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function info(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    if (!w) return { urls: [], activeUrl: null, count: 0 };
    const t = w._filoTabs;
    const a = t.tabs.find((x) => x.id === t.activeId) || null;
    return { urls: t.tabs.map((x) => x.url), activeUrl: a ? a.url : null, count: t.tabs.length };
  });
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

const inArchivio = (app, url) => app.evaluate(async (_e, u) =>
  (await globalThis.SN_ARCHIVED_TABS.list()).some((t) => t.url === u), url);

test('r1 dopo un riavvio Ctrl+Shift+T non riapre di nuovo la scheda già riaperta e rimasta aperta', async ({ testServer }) => {
  test.setTimeout(120_000);
  const vecchia = testServer.html('<title>Chiusa prima</title><h1>v</h1>');
  const ripresa = testServer.html('<title>Ripresa</title><h1>r</h1>');
  const userData = cartellaTemporanea('filo-1476-');
  const launch = () => electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  let app;
  try {
    app = await launch();
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    await apriEAspetta(app, vecchia);
    await premi(app, 'W', ['control']);
    await expect.poll(() => inArchivio(app, vecchia), { timeout: 10_000 }).toBe(true);
    await sleep(50);
    await apriEAspetta(app, ripresa);
    await premi(app, 'W', ['control']);
    await expect.poll(() => inArchivio(app, ripresa), { timeout: 10_000 }).toBe(true);
    // Chiusa per sbaglio e subito ripresa: resta aperta.
    await premi(app, 'T', ['control', 'shift']);
    await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(ripresa);
    await sleep(1500);
    await app.close();
    app = null;

    app = await launch();
    const shell2 = await primaFinestra(app);
    await shell2.waitForLoadState('domcontentloaded');
    await expect.poll(() => info(app).then((i) => i.urls.includes(ripresa)), { timeout: 20_000 }).toBe(true);
    await sleep(1000);
    await premi(app, 'T', ['control', 'shift']);
    // La chiusa da riavere è quella di prima: la ripresa è già lì, aperta.
    await expect.poll(() => info(app).then((i) => i.activeUrl), { timeout: 10_000 }).toBe(vecchia);
    expect((await info(app)).urls.filter((u) => u === ripresa)).toHaveLength(1);
  } finally {
    if (app) { try { await app.close(); } catch (_) {} }
    rmSync(userData, { recursive: true, force: true });
  }
});
