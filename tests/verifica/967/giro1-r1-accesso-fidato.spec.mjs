// Verifica #967 giro 1, rilievo 1: un sito fidato con la password chiesta riceve l'avviso «pericoloso».
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOMI = ['team.com'];

async function miniServer() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>V967 ${req.url}</title><h1>Pagina</h1>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { porta: server.address().port, chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }) };
}

const apri = (shell, url) => shell.evaluate((u) => window.filoShell.tabs.open(u), url);
const fidatiSalvati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.safeBrowse.trustedSites);
const statoScheda = (app, pezzo) => app.evaluate(({ BrowserWindow }, f) => {
  for (const w of BrowserWindow.getAllWindows()) {
    for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
      let u = '';
      try { u = t.view.webContents.getURL(); } catch (_) {}
      if (u.includes(f)) return { livello: t.sbLevel || null, avviso: t.sbAvviso ? t.sbAvviso.level : null };
    }
  }
  return null;
}, pezzo);
const vistaAvviso = (app) => aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/avviso-sito.html'), 'avviso non nato');

test.describe('sito fidato con la pagina di accesso', () => {
  test.use({ hostInPiu: NOMI });
  test('r1 team.com fidato, pagina con la password: nessun avviso', async ({ app, shell }) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<title>LOGIN967</title><form><input name=u><input type=password name=p><button>Accedi</button></form>`);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ security: { safeBrowse: { trustedSites: ['team.com'] } } }));
      await apri(shell, `http://team.com:${server.address().port}/login`);
      await new Promise((r) => setTimeout(r, 6000));
      const s = await statoScheda(app, '/login');
      expect(s.avviso).toBe(null);
    } finally { server.close(); }
  });
});
