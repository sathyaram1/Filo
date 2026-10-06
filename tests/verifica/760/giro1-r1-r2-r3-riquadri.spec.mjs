// Verifica #760 giro 1. r1: una frase sui cookie in un riquadro che funziona non deve far comparire la proposta.
// r2: un riquadro rotto che, senza cookie, rimanda a un altro sottodominio del servizio riceve la proposta lo stesso.
// r3: il nome che il modello dà al servizio si mostra solo se è davvero quel servizio, non un sito che lo contiene nel nome.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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
    if (u.pathname === '/art') {
      html(`<p>articolo</p><iframe id="ri" width="420" height="300" style="border:0" src="http://${u.searchParams.get('h')}.localhost:${porta}/${u.searchParams.get('p')}"></iframe>`);
      return;
    }
    if (u.pathname === '/lungo') {
      const testo = Array.from({ length: 140 }, (_, i) => `notizia${i}`).join(' ');
      html(`<canvas width="200" height="120" style="background:#c45a3b"></canvas><p id="ok">${testo}</p><small>Su questo widget usiamo i cookie: continue to accept cookies or change settings.</small>`);
      return;
    }
    if (u.pathname === '/redir') {
      if (/vista=1/.test(cookie)) { html('<p id="ok">Il post: tramonto sul mare</p>', conCookie); return; }
      res.writeHead(302, { Location: `http://accounts.b.localhost:${porta}/login` });
      res.end();
      return;
    }
    if (u.pathname === '/login') { html('<p>Accedi per vedere il post</p>', conCookie); return; }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    art: (h, p) => `http://a.localhost:${porta}/art?h=${h}&p=${p}`,
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
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      globalThis.__chiamateRiquadri.push(1);
      return { text: '{"rotto": false, "servizio": ""}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
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

test('r1 un riquadro che mostra il suo contenuto, con una frase sui cookie in fondo, non riceve la proposta', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.art('d', 'lungo'));
    await expect(page.frameLocator('#ri').locator('#ok')).toBeVisible();
    await page.waitForTimeout(12_000);
    expect(await proposte(app, 'a.localhost')).toEqual([]);
  } finally {
    await srv.chiudi();
  }
});

test('r2 il riquadro rotto che senza cookie finisce su un altro sottodominio del servizio riceve la proposta, e «Sì» lo ripara', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.art('b', 'redir'));
    await expect(page.frameLocator('#ri').getByText('Accedi per vedere il post')).toBeVisible();
    let lista = [];
    await expect.poll(async () => { lista = await proposte(app, 'a.localhost'); return lista.length; }, { timeout: 25_000 }).toBe(1);
    expect(lista[0].visibile).toBe(true);
    await page.mouse.click(lista[0].si.x, lista[0].si.y);
    await expect(page.frameLocator('#ri').locator('#ok')).toHaveText('Il post: tramonto sul mare', { timeout: 10_000 });
  } finally {
    await srv.chiudi();
  }
});

test('r3 un riquadro di un sito che contiene «instagram» nel nome non viene presentato come Instagram', () => {
  const R = require('../../../src/main/services/riquadriRottiRegole.js');
  expect(R.leggiRisposta('{"rotto": true, "servizio": "Instagram"}', 'instagram-accesso.xyz').nome).toBe('instagram-accesso.xyz');
  expect(R.leggiRisposta('{"rotto": true, "servizio": "Facebook"}', 'facebook-video-login.net').nome).toBe('facebook-video-login.net');
});
