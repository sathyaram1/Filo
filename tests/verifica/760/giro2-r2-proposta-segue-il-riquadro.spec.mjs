// Verifica #760 giro 2. r2: la proposta resta sopra il suo riquadro anche quando la pagina, dopo, cresce sopra di lui
// (una pubblicità o un'immagine arrivata in ritardo).
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function serve() {
  const server = createServer((req, res) => {
    const porta = server.address().port;
    const u = new URL(req.url, 'http://x');
    const cookie = String(req.headers.cookie || '');
    const html = (corpo, extra = {}) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...extra });
      res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px sans-serif">${corpo}`);
    };
    const conCookie = { 'Set-Cookie': ['vista=1; Max-Age=86400; Path=/; SameSite=None; Secure'] };
    const src = (p) => `http://b.localhost:${porta}/${p}`;
    if (u.pathname === '/due') {
      html(`<p>articolo</p><iframe id="r1" width="400" height="220" style="border:0" src="${src('post?n=1')}"></iframe><p>mezzo</p><iframe id="r2" width="400" height="220" style="border:0" src="${src('post?n=2')}"></iframe>`);
      return;
    }
    if (u.pathname === '/post') {
      if (/vista=1/.test(cookie)) html('<p id="ok">Il post: tramonto sul mare</p>', conCookie);
      else html('<p>Accedi per vedere il post</p>', conCookie);
      return;
    }
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

async function prepara(app) {
  await app.evaluate(async () => {
    globalThis.__filoRiquadriRotti.servizioTest({ nome: 'Fotogrammi', domini: ['b.localhost'], segnaposto: ['accedi per vedere il post'] });
    globalThis.SN_URL_NAV.isHomeNetworkUrl = () => false;
  });
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

test('r2 il riquadro si sposta perché la pagina cresce sopra di lui: la proposta lo segue', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.url('due'));
    let lista = [];
    await expect.poll(async () => { lista = await proposte(app, 'a.localhost'); return lista.length; }, { timeout: 30_000 }).toBe(2);
    await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'height:180px;background:#9cf'; d.textContent = 'pubblicità arrivata dopo'; document.body.prepend(d); });
    await page.waitForTimeout(1500);
    lista = await proposte(app, 'a.localhost');
    for (const p of lista) {
      expect(p.si.y).toBeGreaterThan(p.riquadro.y - p.riquadro.h / 2);
      expect(p.si.y).toBeLessThan(p.riquadro.y);
    }
  } finally { await srv.chiudi(); }
});
