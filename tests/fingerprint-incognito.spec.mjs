// #800 — con la protezione accesa, una finestra in incognito mostra ai siti un'impronta sua: diversa dalla
// finestra normale e da ogni altra finestra in incognito, stabile dentro la stessa (anche nel popup di
// accesso nato da una sua scheda). Con la protezione su Off, in incognito i pixel tornano esatti.

import { test, expect } from './fixtures/electron.mjs';
import { fileURLToPath } from 'node:url';

const PAGE_PRELOAD = fileURLToPath(new URL('../src/preload/page-preload.js', import.meta.url));

// Lo stesso canvas di uno script di impronta, letto due volte con getImageData.
const PROBE = `(() => {
  const W = 200, H = 60;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(120,60,200)';
  ctx.fillRect(0, 0, W, H);
  const hash = () => {
    let h = 2166136261;
    for (const v of ctx.getImageData(0, 0, W, H).data) h = Math.imul(h ^ v, 16777619) >>> 0;
    return h;
  };
  const d = ctx.getImageData(0, 0, W, H).data;
  let deviating = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] !== 120 || d[i + 1] !== 60 || d[i + 2] !== 200) deviating++;
  return { prima: hash(), seconda: hash(), deviating, guard: !!window.__filoFpGuard };
})()`;

async function trovaPagina(app, url, tetto = 15_000) {
  const fine = Date.now() + tetto;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`pagina non trovata: ${url}`);
}

const idIncognito = (app) => app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().filter((w) => w._filoIncognito).map((w) => w.id));

async function apriIncognito(app, shell) {
  const prima = await idIncognito(app);
  await shell.evaluate(() => window.filoShell.openIncognito());
  let nuova = null;
  await expect.poll(async () => {
    nuova = (await idIncognito(app)).find((id) => !prima.includes(id)) ?? null;
    return nuova;
  }, { timeout: 15_000 }).not.toBeNull();
  return nuova;
}

async function leggi(page, { protetta = true } = {}) {
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  if (protetta) await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  return page.evaluate(PROBE);
}

async function apriNellaNormale(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  return trovaPagina(app, url);
}

async function apriInIncognito(app, id, url) {
  await app.evaluate(({ BrowserWindow }, a) => { BrowserWindow.fromId(a.id)._filoTabs.openTab(a.url); }, { id, url });
  return trovaPagina(app, url);
}

test('la stessa pagina mostra un\'impronta diversa in ogni finestra in incognito, stabile dentro la stessa', async ({ app, shell, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html('<title>FP_INCOGNITO</title><p>stessa pagina</p>');

  const normale = await leggi(await apriNellaNormale(app, shell, `${url}?w=normale`));
  const incA = await apriIncognito(app, shell);
  const a1 = await leggi(await apriInIncognito(app, incA, `${url}?w=a1`));
  const a2 = await leggi(await apriInIncognito(app, incA, `${url}?w=a2`));
  const incB = await apriIncognito(app, shell);
  const b = await leggi(await apriInIncognito(app, incB, `${url}?w=b`));

  // Il popup di accesso aperto da una scheda in incognito sta fuori dalle finestre di Filo, nella sua sessione.
  await app.evaluate(({ BrowserWindow }, a) => {
    const partition = BrowserWindow.fromId(a.id)._filoTabs.partition;
    const w = new BrowserWindow({ show: false, webPreferences: {
      preload: a.preload, contextIsolation: true, sandbox: false, nodeIntegration: false, partition,
    } });
    w.loadURL(a.url);
  }, { id: incA, url: `${url}?w=popup`, preload: PAGE_PRELOAD });
  const popup = await leggi(await trovaPagina(app, `${url}?w=popup`));

  for (const r of [normale, a1, a2, b, popup]) {
    expect(r.guard).toBe(true);
    expect(r.deviating).toBeGreaterThan(0);
    expect(r.prima).toBe(r.seconda);
  }
  expect(a1.prima).not.toBe(normale.prima);
  expect(b.prima).not.toBe(normale.prima);
  expect(b.prima).not.toBe(a1.prima);
  expect(a2.prima).toBe(a1.prima);
  expect(popup.prima).toBe(a1.prima);
});

test('con la protezione su Off, in incognito i pixel del canvas tornano esatti', async ({ app, shell, openTab, testServer }) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator('input[name="fp-mode"][value="off"]').check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  const inc = await apriIncognito(app, shell);
  const r = await leggi(await apriInIncognito(app, inc, testServer.html('<title>FP_OFF_INC</title><p>ok</p>')), { protetta: false });
  expect(r.guard).toBe(false);
  expect(r.deviating).toBe(0);
});
