// Verifica #760 giro 3, esplorazione.
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
    const src = (h, p) => `http://${h}.localhost:${porta}/${p}`;
    if (u.pathname === '/art') {
      html(`<p>articolo</p><iframe id="ri" width="420" height="300" style="border:0" src="${src(u.searchParams.get('h'), u.searchParams.get('p'))}"></iframe><div style="height:3000px">testo</div>`);
      return;
    }
    if (u.pathname === '/carosello') {
      html(`<p>articolo</p><div id="car" style="width:440px;overflow-x:auto;white-space:nowrap"><iframe id="r1" width="420" height="300" style="border:0" src="${src('b', 'post?n=1')}"></iframe><div style="display:inline-block;width:440px;height:300px;background:#cde">altro</div></div><p>fine</p>`);
      return;
    }
    if (u.pathname === '/rimosso') { html('<div style="padding:40px"><p>This video is unavailable</p></div>'); return; }
    if (u.pathname === '/vuoto') {
      if (/vista=1/.test(cookie)) html('<p id="ok">La mappa del quartiere</p>', conCookie);
      else html('<div style="padding:40px"><button>Accedi</button></div>', conCookie);
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
    art: (h, p) => `http://a.localhost:${porta}/art?h=${h}&p=${p}`,
    altro: (h, p) => `http://e.localhost:${porta}/art?h=${h}&p=${p}`,
    pagina: (p) => `http://a.localhost:${porta}/${p}`,
    async chiudi() { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    globalThis.__filoRiquadriRotti.servizioTest({ nome: 'Fotogrammi', domini: ['b.localhost'], segnaposto: ['accedi per vedere il post'] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EMBED_COOKIE_CHECK]: 'gemma' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_URL_NAV.isHomeNetworkUrl = () => false;
    globalThis.__chiamateRiquadri = [];
    globalThis.__rispostaRiquadri = '{"rotto": true, "servizio": ""}';
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      globalThis.__chiamateRiquadri.push(1);
      return { text: globalThis.__rispostaRiquadri, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

const chiamate = (app) => app.evaluate(() => (globalThis.__chiamateRiquadri || []).length);

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

test('cache: un riquadro con contenuto rimosso giudicato non rotto non spegne la proposta sugli altri riquadri rotti del servizio', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    await app.evaluate(() => { globalThis.__rispostaRiquadri = '{"rotto": false, "servizio": ""}'; });
    await openTab(srv.art('d', 'rimosso'));
    await expect.poll(() => chiamate(app), { timeout: 25_000 }).toBe(1);
    await app.evaluate(() => { globalThis.__rispostaRiquadri = '{"rotto": true, "servizio": ""}'; });
    await openTab(srv.altro('d', 'vuoto'));
    await expect.poll(async () => (await proposte(app, 'e.localhost')).length, { timeout: 25_000 }).toBe(1);
  } finally { await srv.chiudi(); }
});

test('scorrere via subito: il riquadro sconosciuto rotto riceve la proposta quando si torna a vederlo', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.art('d', 'vuoto'));
    await page.waitForTimeout(800);
    await page.evaluate(() => window.scrollTo(0, 2500));
    await page.waitForTimeout(14_000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await proposte(app, 'a.localhost')).length, { timeout: 25_000 }).toBe(1);
  } finally { await srv.chiudi(); }
});

test('carosello: il riquadro uscito dal contenitore che scorre porta via la sua proposta', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.pagina('carosello'));
    await expect.poll(async () => (await proposte(app, 'a.localhost')).length, { timeout: 25_000 }).toBe(1);
    await page.evaluate(() => { document.getElementById('car').scrollLeft = 440; });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'tests/.shots/760-g3-carosello.png' });
    const [p] = await proposte(app, 'a.localhost');
    expect(p.visibile).toBe(false);
  } finally { await srv.chiudi(); }
});
