// #839 giro 4 r1 — in incognito, quando la pagina non prende Alt+S (bloccata o ancora in caricamento), il salvataggio
// fatto dal main finisce nella lista normale sul disco invece che nella memoria della sessione incognito.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const pagina = (t) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title></head><body style="background:#fda085"><h1>${t}</h1></body></html>`;

async function apriIncognito(app, shell) {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w ? w._filoTabs.tabs.length : 0;
  }), { timeout: 15000 }).toBe(1);
}

const apriInIncognito = (app, u) => app.evaluate(({ BrowserWindow }, x) => {
  const w = BrowserWindow.getAllWindows().find((y) => y._filoIncognito);
  w._filoTabs.openTab(x); w.show(); w.focus();
}, u);

const altSInIncognito = (app) => app.evaluate(({ BrowserWindow }) => {
  globalThis.__filoShortcuts.dispatch('save-for-later', BrowserWindow.getAllWindows().find((x) => x._filoIncognito));
});

const apertaInIncognito = (app, u) => app.evaluate(({ BrowserWindow }, x) => {
  const w = BrowserWindow.getAllWindows().find((y) => y._filoIncognito);
  return w._filoTabs.tabs.some((t) => t.url === x);
}, u);

const salvate = (app) => app.evaluate(async () => ({
  disco: (await globalThis.SN_SAVED_PAGES.list()).map((x) => x.url),
  sessione: await globalThis.__filoStorage.runIncognito(async () => (await globalThis.SN_SAVED_PAGES.list()).map((x) => x.url)),
}));

test('incognito, pagina bloccata: Alt+S la mette da parte nella sessione, non sul disco', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, pagina('Finestra normale'));
  await apriIncognito(app, shell);
  const url = testServer.html(pagina('Segreta bloccata'));
  await apriInIncognito(app, url);
  let p = null;
  await expect.poll(async () => {
    p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return p ? p.evaluate(() => document.documentElement.dataset.filoContentReady === '1').catch(() => false) : false;
  }, { timeout: 10000 }).toBe(true);
  await p.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
  await p.waitForTimeout(200);
  await altSInIncognito(app);

  await expect.poll(() => apertaInIncognito(app, url), { timeout: 12000 }).toBe(false);
  await new Promise((r) => setTimeout(r, 1500));
  expect(await salvate(app), 'la pagina vista in incognito è finita nella lista normale sul disco').toEqual({ disco: [], sessione: [url] });
});

test('incognito, pagina ancora in caricamento: Alt+S la mette da parte nella sessione, non sul disco', async ({ app, shell, openTab, testServer }) => {
  const attese = [];
  const server = createServer((req, res) => {
    if (req.url.startsWith('/lento.js')) { attese.push(res); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Segreta lenta</title></head><body><h1>Segreta lenta</h1><script src="/lento.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://localhost:${server.address().port}/p`;
  try {
    await testServer.openReady(openTab, pagina('Finestra normale'));
    await apriIncognito(app, shell);
    await apriInIncognito(app, url);
    await expect.poll(() => apertaInIncognito(app, url), { timeout: 8000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    await altSInIncognito(app);

    await expect.poll(() => apertaInIncognito(app, url), { timeout: 12000 }).toBe(false);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await salvate(app), 'la pagina vista in incognito è finita nella lista normale sul disco').toEqual({ disco: [], sessione: [url] });
  } finally {
    for (const res of attese.splice(0)) { try { res.end(''); } catch (_) {} }
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});
