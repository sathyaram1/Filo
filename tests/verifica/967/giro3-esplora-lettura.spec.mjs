// Verifica #967 giro 3: esplorazione, Filo che legge una pagina di un sito di cui l'utente si fida.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function miniServer() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>V967 ${req.url}</title><h1>Pagina di prova</h1><p>Il prezzo è 12 euro.</p>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { porta: server.address().port, chiudi: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }) };
}

test.describe('lettura', () => {
  test.use({ hostInPiu: ['team.com'] });
  test('Filo legge una pagina di un sito fidato: niente «sospetto» per il modello', async ({ app, shell }) => {
    const srv = await miniServer();
    try {
      await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ security: { safeBrowse: { trustedSites: ['team.com'] } } }));
      const url = `http://team.com:${srv.porta}/legge`;
      await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
      await shell.waitForTimeout(3000);
      const r = await app.evaluate(async (_e, u) => {
        const x = await globalThis.__filoHandlers.executeFiloAction({ type: 'LEGGI_PAGINA', url: u }, { confirmed: true, sender: { url: 'filo://newtab/' } });
        return JSON.stringify(x).slice(0, 3000);
      }, url);
      console.log('ESITO', r);
      expect(r).toContain('12 euro');
      expect(r).not.toMatch(/sospett/i);
    } finally { await srv.chiudi(); }
  });
});
