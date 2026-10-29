// Verifica #967 giro 2: sonde sui «Siti di cui ti fidi».
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const NOMI = ['team.com'];

async function miniServer() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>V967b ${req.url}</title><h1>Pagina</h1>`);
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

test.describe('sonde', () => {
  test.use({ hostInPiu: NOMI });

  test('due schede sullo stesso sito sospetto: «Continua» in una toglie l\'avviso anche dall\'altra', async ({ app, shell }) => {
    const srv = await miniServer();
    try {
      await apri(shell, `http://team.com:${srv.porta}/prima`);
      await expect.poll(async () => (await statoScheda(app, '/prima'))?.avviso, { timeout: 12_000 }).toBe('sospetto');
      await apri(shell, `http://team.com:${srv.porta}/seconda`);
      await expect.poll(async () => (await statoScheda(app, '/seconda'))?.avviso, { timeout: 12_000 }).toBe('sospetto');
      const avviso = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/avviso-sito.html'), 'avviso');
      const continua = avviso.getByRole('button', { name: 'Continua' });
      await expect(continua).toBeEnabled({ timeout: 12_000 });
      await continua.click();
      await expect.poll(() => fidatiSalvati(app)).toEqual(['team.com']);
      await expect.poll(async () => (await statoScheda(app, '/seconda'))?.avviso, { timeout: 8000 }).toBe(null);
      await expect.poll(async () => (await statoScheda(app, '/prima'))?.avviso, { timeout: 8000 }).toBe(null);
      // Tolto dall'elenco: tutte e due lo riprendono.
      await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ security: { safeBrowse: { trustedSites: [] } } }));
      await expect.poll(async () => (await statoScheda(app, '/seconda'))?.avviso, { timeout: 8000 }).toBe('sospetto');
      await expect.poll(async () => (await statoScheda(app, '/prima'))?.avviso, { timeout: 8000 }).toBe('sospetto');
    } finally { await srv.chiudi(); }
  });

  test('chat: «solo team.com» e «svuota» passano dal costo giusto', async ({ app }) => {
    const r = await app.evaluate(() => {
      const P = globalThis.SN_PREF;
      const s = P.setterDellaChiave('siti_di_cui_ti_fidi');
      const att = { security: { safeBrowse: { trustedSites: ['team.com'] } } };
      const c = (v) => { const b = s.build(v); return s.costoDi ? s.costoDi(b) : s.costo; };
      return { svuota: c('svuota'), togli: c('togli team.com'), aggiungi: c('aggiungi team.com'), att: !!att };
    });
    expect(r.togli).toBe(1);
    expect(r.aggiungi).toBe(3);
  });
});
