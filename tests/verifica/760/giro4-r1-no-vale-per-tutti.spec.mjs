// Verifica #760 giro 4. r1: «No» su una proposta vale per il servizio su quel sito, come «Sì»: le altre proposte dello
// stesso servizio nella pagina se ne vanno insieme, invece di restare a chiedere la stessa cosa.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function serve() {
  const server = createServer((req, res) => {
    const porta = server.address().port;
    const u = new URL(req.url, 'http://x');
    const html = (corpo) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px sans-serif">${corpo}`);
    };
    if (u.pathname === '/due') {
      const ri = (id) => `<iframe id="${id}" width="400" height="220" style="border:0" src="http://b.localhost:${porta}/post?n=${id}"></iframe>`;
      html(`<p>articolo</p>${ri('r1')}<p>mezzo</p>${ri('r2')}`);
      return;
    }
    if (u.pathname === '/post') { html('<p>Accedi per vedere il post</p>'); return; }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    url: (p) => `http://a.localhost:${porta}/${p}`,
    async chiudi() { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

function proposte(app, frammento) {
  return app.evaluate(async ({ BrowserWindow }, f) => {
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
        const wc = t.view && t.view.webContents;
        if (!wc || wc.isDestroyed() || !wc.getURL().includes(f)) continue;
        return wc.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.SN_RIQUADRO_COOKIE?._test?.proposte() ?? []' }]);
      }
    }
    return [];
  }, frammento);
}

test('r1 «No» su una delle due proposte dello stesso servizio chiude anche l\'altra', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await app.evaluate(() => {
      globalThis.__filoRiquadriRotti.servizioTest({ nome: 'Fotogrammi', domini: ['b.localhost'], segnaposto: ['accedi per vedere il post'] });
      globalThis.SN_URL_NAV.isHomeNetworkUrl = () => false;
    });
    const page = await openTab(srv.url('due'));
    let lista = [];
    await expect.poll(async () => { lista = await proposte(app, 'a.localhost'); return lista.length; }, { timeout: 30_000 }).toBe(2);
    await page.mouse.click(lista[0].no.x, lista[0].no.y);
    await expect.poll(async () => (await proposte(app, 'a.localhost')).length, { timeout: 5_000 }).toBe(0);
  } finally {
    await srv.chiudi();
  }
});
