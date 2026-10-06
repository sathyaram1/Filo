// Verifica #760 giro 4. r1: «No» vale per il servizio su quel sito, come «Sì»: le altre proposte dello stesso servizio
// nella pagina se ne vanno insieme, invece di restare a chiedere quello a cui si è già risposto.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const LARGO = 420;
const ALTO = 300;

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
      const h = u.searchParams.get('h');
      const p = u.searchParams.get('p');
      html(`<title>ARTICOLO</title><p>articolo</p><iframe id="ri" width="${LARGO}" height="${ALTO}" style="border:0" src="http://${h}.localhost:${porta}/${p}"></iframe><p>fine</p>`);
      return;
    }
    // Un articolo lungo: il riquadro in alto, e tanto testo sotto da scorrerlo via.
    if (u.pathname === '/lungo') {
      html(`<p>articolo</p><iframe id="ri" width="${LARGO}" height="${ALTO}" style="border:0" src="http://${u.searchParams.get('h')}.localhost:${porta}/${u.searchParams.get('p')}"></iframe><div style="height:3000px">testo</div>`);
      return;
    }
    // Un contenuto che l'autore ha tolto: il riquadro non è rotto dai cookie.
    if (u.pathname === '/rimosso') {
      html('<div style="padding:40px"><p>This video is unavailable</p></div>');
      return;
    }
    // Il riquadro stretto di una colonna laterale, e due riquadri dello stesso servizio in un articolo.
    if (u.pathname === '/stretto') {
      html(`<p>articolo</p><iframe id="ri" width="190" height="260" style="border:0;margin-left:30px" src="http://b.localhost:${porta}/post"></iframe>`);
      return;
    }
    if (u.pathname === '/due') {
      const ri = (id) => `<iframe id="${id}" width="400" height="220" style="border:0" src="http://b.localhost:${porta}/post?n=${id}"></iframe>`;
      html(`<p>articolo</p>${ri('r1')}<p>mezzo</p>${ri('r2')}`);
      return;
    }
    if (u.pathname === '/post') {
      // Il servizio noto: senza il suo cookie mostra il segnaposto, con il cookie il post. Il cookie lo rinfresca
      // a ogni caricamento, come fanno i servizi veri.
      if (/vista=1/.test(cookie)) html('<p id="ok">Il post: tramonto sul mare</p>', conCookie);
      else html('<p>Accedi per vedere il post</p>', conCookie);
      return;
    }
    if (u.pathname === '/vuoto') {
      if (/vista=1/.test(cookie)) html('<p id="ok">La mappa del quartiere</p>', conCookie);
      else html('<div style="padding:40px"><button>Accedi</button></div>', conCookie);
      return;
    }
    // Senza cookie il riquadro viene rimandato all'accesso, su un altro sottodominio dello stesso servizio.
    if (u.pathname === '/redir') {
      if (/vista=1/.test(cookie)) { html('<p id="ok">Il contenuto dopo l\'accesso</p>', conCookie); return; }
      const host = String(req.headers.host || '').split(':')[0];
      res.writeHead(302, { Location: `http://accounts.${host}:${porta}/login` });
      res.end();
      return;
    }
    if (u.pathname === '/login') {
      // Il cookie vale per tutto il servizio, come quelli di un accesso vero.
      const host = String(req.headers.host || '').split(':')[0];
      const delServizio = { 'Set-Cookie': [`vista=1; Max-Age=86400; Path=/; Domain=${host.replace(/^accounts\./, '')}; SameSite=None; Secure`] };
      if (/^accounts\.b\./.test(host)) html('<p>Accedi per vedere il post</p>', delServizio);
      else html('<div style="padding:40px"><button>Accedi</button></div>', delServizio);
      return;
    }
    if (u.pathname === '/funziona') {
      const testo = Array.from({ length: 140 }, (_, i) => `parola${i}`).join(' ');
      html(`<canvas width="200" height="120" style="background:#c45a3b"></canvas><p>${testo}</p>`);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    art: (h, p) => `http://a.localhost:${porta}/art?h=${h}&p=${p}`,
    artSu: (ospite, h, p) => `http://${ospite}.localhost:${porta}/art?h=${h}&p=${p}`,
    lungo: (h, p) => `http://a.localhost:${porta}/lungo?h=${h}&p=${p}`,
    pagina: (p) => `http://a.localhost:${porta}/${p}`,
    async chiudi() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

// b.localhost fa la parte di un servizio noto col suo segnaposto; il modello è finto e ogni chiamata si conta.
// I siti di casa non vanno mai al modello (#591): qui tutto è su localhost, quindi il controllo si spegne.
async function prepara(app, { risposta = '{"rotto": true, "servizio": "Cosmo"}' } = {}) {
  await app.evaluate(async ({ nativeImage }, risp) => {
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
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const u = messages.find((m) => m.role === 'user');
      const img = Array.isArray(u.content) ? u.content.find((p) => p.type === 'image_url') : null;
      let misura = null;
      if (img) misura = nativeImage.createFromDataURL(img.image_url.url).getSize();
      globalThis.__chiamateRiquadri.push({ immagine: !!img, misura });
      return { text: risp, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, risposta);
}

const chiamate = (app) => app.evaluate(() => globalThis.__chiamateRiquadri || []);

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

test('r1 «No» su una di due proposte dello stesso servizio chiude anche l\'altra, come fa «Sì»', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    await prepara(app);
    const page = await openTab(srv.pagina('due'));
    let lista = [];
    await expect.poll(async () => { lista = await proposte(app, 'a.localhost'); return lista.length; }, { timeout: 30_000 }).toBe(2);
    await page.mouse.click(lista[0].no.x, lista[0].no.y);
    await expect.poll(async () => (await proposte(app, 'a.localhost')).length, { timeout: 5_000 }).toBe(0);
  } finally {
    await srv.chiudi();
  }
});
