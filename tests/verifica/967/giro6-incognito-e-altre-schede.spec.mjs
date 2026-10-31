// Verifica #967 giro 6: incognito e schede già aperte sullo stesso sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const NOMI = ['team.com'];

async function miniServer() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>G6 ${req.url}</title><h1>Pagina</h1>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { porta: server.address().port, chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }) };
}

const fidatiSalvati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.safeBrowse.trustedSites);
const stato = (app, pezzo) => app.evaluate(({ BrowserWindow }, f) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      let u = '';
      try { u = t.view.webContents.getURL(); } catch (_) {}
      if (u.includes(f)) return { livello: t.sbLevel || null, avviso: t.sbAvviso ? t.sbAvviso.level : null, incognito: !!w._filoIncognito };
    }
  }
  return null;
}, pezzo);
// Il «Continua» dell'avviso, sulla scheda il cui indirizzo contiene `pezzo`: lo stesso metodo che chiama il pulsante.
const continua = (app, pezzo) => app.evaluate(({ BrowserWindow }, f) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      let u = '';
      try { u = t.view.webContents.getURL(); } catch (_) {}
      if (u.includes(f)) return w._filoTabs.safebrowseDismiss(t.id, u);
    }
  }
  return null;
}, pezzo);

test.describe('giro 6', () => {
  test.use({ hostInPiu: NOMI });

  test('«Continua» in una scheda: le altre schede già aperte sullo stesso sito perdono l\'avviso', async ({ app, shell }) => {
    const srv = await miniServer();
    try {
      await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://team.com:${srv.porta}/a1`);
      await expect.poll(async () => (await stato(app, '/a1'))?.avviso, { timeout: 12_000 }).toBe('sospetto');
      await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://login.team.com:${srv.porta}/a2`);
      await expect.poll(async () => (await stato(app, '/a2'))?.avviso, { timeout: 12_000 }).toBe('sospetto');
      expect((await continua(app, '/a2'))?.ok).toBe(true);
      await expect.poll(() => fidatiSalvati(app)).toEqual(['team.com']);
      await expect.poll(async () => (await stato(app, '/a1'))?.avviso).toBe(null);
      await expect.poll(async () => (await stato(app, '/a2'))?.avviso).toBe(null);
    } finally { await srv.chiudi(); }
  });

  test('incognito: il «Continua» non entra nell\'elenco, ma un sito già fidato non avvisa', async ({ app, shell }) => {
    const srv = await miniServer();
    try {
      await shell.evaluate(() => window.filoShell.openIncognito());
      const apriInc = (url) => app.evaluate(({ BrowserWindow }, u) => {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
        if (!w || !w._filoTabs) return false;
        w._filoTabs.openTab(u);
        return true;
      }, url);
      await expect.poll(() => apriInc(`http://team.com:${srv.porta}/inc1`), { timeout: 15_000 }).toBe(true);
      await expect.poll(async () => (await stato(app, '/inc1'))?.avviso, { timeout: 12_000 }).toBe('sospetto');
      expect((await continua(app, '/inc1'))?.ok).toBe(true);
      await expect.poll(async () => (await stato(app, '/inc1'))?.avviso).toBe(null);
      await new Promise((r) => setTimeout(r, 1000));
      expect(await fidatiSalvati(app)).toEqual([]);

      await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ security: { safeBrowse: { trustedSites: ['team.com'] } } }));
      await apriInc(`http://team.com:${srv.porta}/inc2`);
      await expect.poll(async () => (await stato(app, '/inc2'))?.livello, { timeout: 12_000 }).toBe('safe');
      expect((await stato(app, '/inc2')).avviso).toBe(null);
    } finally { await srv.chiudi(); }
  });
});
