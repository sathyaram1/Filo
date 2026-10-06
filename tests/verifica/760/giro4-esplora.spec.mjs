// Verifica #760 giro 4: esplorazione.
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
    if (u.pathname === '/due') {
      const ri = (id) => `<iframe id="${id}" width="400" height="220" style="border:0" src="http://b.localhost:${porta}/post?n=${id}"></iframe>`;
      html(`<p>articolo</p>${ri('r1')}<p>mezzo</p>${ri('r2')}`);
      return;
    }
    if (u.pathname === '/art') {
      html(`<p>articolo</p><iframe id="ri" width="420" height="300" style="border:0" src="http://${u.searchParams.get('h')}.localhost:${porta}/${u.searchParams.get('p')}"></iframe>`);
      return;
    }
    if (u.pathname === '/involucro') {
      html(`<iframe width="440" height="320" style="border:0" src="http://b.localhost:${porta}/post"></iframe>`);
      return;
    }
    if (u.pathname === '/avvolto') {
      html(`<p>articolo</p><iframe id="ri" width="460" height="340" style="border:0" src="http://w.localhost:${porta}/involucro"></iframe>`);
      return;
    }
    if (u.pathname === '/post') {
      if (/vista=1/.test(cookie)) html('<p id="ok">Il post: tramonto sul mare</p>', conCookie);
      else html('<p>Accedi per vedere il post</p>', conCookie);
      return;
    }
    if (u.pathname === '/vuoto') {
      if (/vista=1/.test(cookie)) html('<p id="ok">La mappa</p>', conCookie);
      else html('<div style="padding:40px"><button>Accedi</button></div>', conCookie);
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
    const C = globalThis.SN_CONST;
    globalThis.__filoRiquadriRotti.servizioTest({ nome: 'Fotogrammi', domini: ['b.localhost'], segnaposto: ['accedi per vedere il post'] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EMBED_COOKIE_CHECK]: 'gemma' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_URL_NAV.isHomeNetworkUrl = () => false;
    globalThis.__chiamateRiquadri = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      globalThis.__chiamateRiquadri.push(1);
      return { text: '{"rotto": true, "servizio": "Cosmo"}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

const chiamate = (app) => app.evaluate(() => (globalThis.__chiamateRiquadri || []).length);

function proposte(app, frammento) {
  return app.evaluate(async ({ BrowserWindow }, f) => {
    const out = [];
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
        const wc = t.view && t.view.webContents;
        if (!wc || wc.isDestroyed() || !wc.getURL().includes(f)) continue;
        out.push(...(await wc.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.SN_RIQUADRO_COOKIE?._test?.proposte() ?? []' }])));
      }
    }
    return out;
  }, frammento);
}

test('A «No» su una di due proposte dello stesso servizio', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.url('due'));
    let lista = [];
    await expect.poll(async () => { lista = await proposte(app, 'a.localhost'); return lista.length; }, { timeout: 30_000 }).toBe(2);
    await page.mouse.click(lista[0].no.x, lista[0].no.y);
    await page.waitForTimeout(2000);
    console.log('A rimaste dopo No:', (await proposte(app, 'a.localhost')).length);
  } finally { await srv.chiudi(); }
});

test('B ricarica della pagina con un riquadro sconosciuto rotto', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.url('art?h=cosmo&p=vuoto'));
    await expect.poll(async () => (await proposte(app, 'a.localhost')).length, { timeout: 30_000 }).toBe(1);
    await page.reload();
    await expect.poll(async () => (await proposte(app, 'a.localhost')).length, { timeout: 30_000 }).toBe(1);
    await page.reload();
    await expect.poll(async () => (await proposte(app, 'a.localhost')).length, { timeout: 30_000 }).toBe(1);
    console.log('B chiamate dopo 2 ricariche:', await chiamate(app));
  } finally { await srv.chiudi(); }
});

test('C riquadro dentro un involucro di un altro sito', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.url('avvolto'));
    let lista = [];
    await expect.poll(async () => { lista = await proposte(app, 'a.localhost'); return lista.length; }, { timeout: 30_000 }).toBe(1);
    console.log('C proposta:', JSON.stringify(lista[0]));
    await page.screenshot({ path: 'tests/.shots/g4-avvolto.png' });
    await page.mouse.click(lista[0].si.x, lista[0].si.y);
    await expect(page.frameLocator('#ri').frameLocator('iframe').locator('#ok')).toBeVisible({ timeout: 10_000 });
  } finally { await srv.chiudi(); }
});
