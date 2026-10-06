// Verifica #760 giro 2, esplorazione: riquadro stretto, due riquadri dello stesso servizio, riquadro sotto la piega.
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
    if (u.pathname === '/stretto') {
      html(`<p>articolo</p><iframe id="ri" width="190" height="260" style="border:0;margin-left:30px" src="${src('post')}"></iframe>`);
      return;
    }
    if (u.pathname === '/due') {
      html(`<p>articolo</p><iframe id="r1" width="400" height="220" style="border:0" src="${src('post?n=1')}"></iframe><p>mezzo</p><iframe id="r2" width="400" height="220" style="border:0" src="${src('post?n=2')}"></iframe>`);
      return;
    }
    if (u.pathname === '/giu') {
      html(`<div style="height:1600px;background:linear-gradient(#eee,#ccc)">testo lungo</div><iframe id="ri" width="420" height="260" style="border:0" src="${src('post')}"></iframe><div style="height:600px"></div>`);
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

test('riquadro stretto: la proposta resta leggibile e dentro il riquadro', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.url('stretto'));
    let lista = [];
    await expect.poll(async () => { lista = await proposte(app, 'a.localhost'); return lista.length; }, { timeout: 25_000 }).toBe(1);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tests/.shots/760-g2-stretto.png' });
    await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'tests/.shots/760-g2-stretto-scuro.png' });
    console.log('STRETTO', JSON.stringify(lista[0]));
  } finally { await srv.chiudi(); }
});

test('due riquadri dello stesso servizio: due proposte, «Sì» su una ripara entrambi', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.url('due'));
    let lista = [];
    await expect.poll(async () => { lista = await proposte(app, 'a.localhost'); return lista.length; }, { timeout: 30_000 }).toBe(2);
    await page.screenshot({ path: 'tests/.shots/760-g2-due.png' });
    await page.mouse.click(lista[1].si.x, lista[1].si.y);
    await expect(page.frameLocator('#r1').locator('#ok')).toBeVisible({ timeout: 10_000 });
    await expect(page.frameLocator('#r2').locator('#ok')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2500);
    expect(await proposte(app, 'a.localhost')).toEqual([]);
  } finally { await srv.chiudi(); }
});

test('riquadro sotto la piega: la proposta arriva quando lo si raggiunge, sopra di lui', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.url('giu'));
    await page.waitForTimeout(9000);
    const prima = await proposte(app, 'a.localhost');
    console.log('PRIMA DELLO SCORRIMENTO', prima.length);
    await page.mouse.wheel(0, 1500);
    let lista = [];
    await expect.poll(async () => { lista = await proposte(app, 'a.localhost'); return lista.length; }, { timeout: 25_000 }).toBe(1);
    await page.waitForTimeout(400);
    lista = await proposte(app, 'a.localhost');
    await page.screenshot({ path: 'tests/.shots/760-g2-giu.png' });
    console.log('GIU', JSON.stringify(lista[0]));
    expect(lista[0].si.y).toBeGreaterThan(lista[0].riquadro.y - lista[0].riquadro.h / 2);
    expect(lista[0].si.y).toBeLessThan(lista[0].riquadro.y);
  } finally { await srv.chiudi(); }
});
