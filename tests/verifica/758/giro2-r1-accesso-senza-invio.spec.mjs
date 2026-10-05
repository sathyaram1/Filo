// Verifica #758 giro 2, rilievo 1: una richiesta POST qualunque della home col modulo d'accesso vale come accesso.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function serve() {
  const server = createServer((req, res) => {
    const porta = server.address().port;
    if (req.url.startsWith('/log')) {
      // Il registro statistico che le home dei social chiamano in POST appena caricate.
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url.startsWith('/visita')) {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Set-Cookie': ['_session_id=v1; Max-Age=86400; Path=/; HttpOnly'] });
      res.end('ok');
      return;
    }
    if (req.url.startsWith('/home-post')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>HOME</title><form><input type="password" id="pw"></form>'
        + '<script>setTimeout(()=>fetch("/log",{method:"POST",body:"x"}),800);setTimeout(()=>fetch("/visita"),1800)</script>');
      return;
    }
    if (req.url.startsWith('/accedi-form')) {
      res.writeHead(302, { Location: '/dentro', 'Set-Cookie': ['sessionid=s1; Max-Age=86400; Path=/; HttpOnly'] });
      res.end();
      return;
    }
    if (req.url.startsWith('/dentro')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>DENTRO</title><p>dentro</p>');
      return;
    }
    if (req.url.startsWith('/form-accesso')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>ACCESSO</title><form method="post" action="/accedi-form"><input name="u" id="u"><input type="password" name="p" id="pw"><button id="go">Entra</button></form>');
      return;
    }
    if (req.url.startsWith('/riquadro-traccia')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': ['mid=nuovo; Max-Age=86400; Path=/; SameSite=None; Secure'] });
      res.end('<p>riquadro</p>');
      return;
    }
    if (req.url.startsWith('/riquadro-doppio')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p>riquadro</p><script>document.cookie="stato=1; max-age=3600; path=/; SameSite=None; Secure";document.cookie="stato=2; max-age=3600; path=/; SameSite=None; Secure";</script>');
      return;
    }
    const rif = req.url.startsWith('/art-traccia') ? 'riquadro-traccia' : 'riquadro-doppio';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>ARTICOLO</title><p>articolo</p><iframe id="ri" src="http://b.localhost:${porta}/${rif}"></iframe>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    homePost: `http://b.localhost:${porta}/home-post`,
    loginForm: `http://b.localhost:${porta}/form-accesso`,
    artTraccia: `http://a.localhost:${porta}/art-traccia`,
    artDoppio: `http://a.localhost:${porta}/art-doppio`,
    async chiudi() { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

const cookieDiB = (app) => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost' }))
  .map((c) => ({ name: c.name, value: c.value, session: !!c.session })));
const loggati = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.loggedSites || []);

function chiudiSchede(app, pezzo) {
  return app.evaluate(({ BrowserWindow }, f) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs; if (!tm) continue;
      for (const t of [...(tm.tabs || [])]) if (String(t.url || '').includes(f)) { try { tm.closeTab(t.id); } catch (_) {} }
    }
  }, pezzo);
}

async function pulisci(app) {
  await app.evaluate(async () => {
    const S = globalThis.__filoCookieIncorporati;
    S.margineTest(800);
    for (let i = 0; i < 20; i++) { await S.giroDiPulizia(); await new Promise((r) => setTimeout(r, 150)); }
  });
}

test('home col modulo d\'accesso che manda una statistica in POST: senza entrare non diventa un sito con accesso', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const p = await openTab(srv.homePost);
    await p.waitForSelector('#pw');
    await expect.poll(() => cookieDiB(app).then((l) => l.map((c) => c.name)), { timeout: 10_000 }).toContain('_session_id');
    await new Promise((r) => setTimeout(r, 1000));
    expect(await loggati(app)).not.toContain('b.localhost');
  } finally { await srv.chiudi(); }
});

test('controprova: un accesso col modulo inviato davvero segna il sito', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const p = await openTab(srv.loginForm);
    await p.waitForSelector('#pw');
    await new Promise((r) => setTimeout(r, 800));
    await p.fill('#u', 'io');
    await p.fill('#pw', 'segreta');
    await p.click('#go');
    await expect.poll(() => loggati(app), { timeout: 10_000 }).toContain('b.localhost');
  } finally { await srv.chiudi(); }
});
