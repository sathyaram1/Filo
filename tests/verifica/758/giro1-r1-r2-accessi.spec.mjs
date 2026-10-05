// Verifica #758 giro 1: rilievo 1 (accesso fatto prima, rinfrescato dal riquadro) e rilievo 2 (home col modulo d'accesso).
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function serve() {
  const server = createServer((req, res) => {
    const porta = server.address().port;
    if (req.url.startsWith('/riquadro-rinfresca')) {
      // Il riquadro di un sito dove sei già entrato rinfresca il suo cookie d'accesso (come fanno i servizi veri).
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': ['sessionid=abc; Max-Age=86400; Path=/; SameSite=None; Secure'],
      });
      res.end('<p>riquadro</p>');
      return;
    }
    if (req.url.startsWith('/riquadro')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': ['mid=1; Max-Age=3600; Path=/; SameSite=None; Secure'],
      });
      res.end('<p>riquadro</p>');
      return;
    }
    if (req.url.startsWith('/visita')) {
      // Cookie da visitatore che un sito mette dopo il caricamento (bootstrap di una SPA): nessun accesso.
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Set-Cookie': ['_session_id=v1; Max-Age=86400; Path=/; HttpOnly'] });
      res.end('ok');
      return;
    }
    if (req.url.startsWith('/home-con-login')) {
      // La home di un social per chi non ha account: il modulo d'accesso è nella pagina stessa.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>HOME</title><form><input type="password" id="pw"></form><script>setTimeout(()=>fetch("/visita"),1500)</script>');
      return;
    }
    const rif = req.url.startsWith('/art-rinfresca') ? 'riquadro-rinfresca' : 'riquadro';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>ARTICOLO</title><p>articolo</p><iframe id="ri" src="http://b.localhost:${porta}/${rif}"></iframe>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    porta,
    articolo: `http://a.localhost:${porta}/`,
    articoloRinfresca: `http://a.localhost:${porta}/art-rinfresca`,
    homeB: `http://b.localhost:${porta}/home-con-login`,
    async chiudi() { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

const cookieDiB = (app) => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost' }))
  .map((c) => ({ name: c.name, session: !!c.session })));

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

test('r1 — chi era già entrato prima dell\'aggiornamento: il riquadro che rinfresca l\'accesso non lo fa uscire', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    // Accesso fatto prima di questa versione: il cookie d'accesso persistente c'è, Filo non l'ha «visto» nascere.
    await app.evaluate(async ({ session }) => {
      await session.defaultSession.cookies.set({ url: 'http://b.localhost/', name: 'sessionid', value: 'abc', path: '/', expirationDate: Date.now() / 1000 + 86400 * 30 });
    });
    await openTab(srv.articoloRinfresca);
    await expect.poll(() => cookieDiB(app).then((l) => l.find((c) => c.name === 'sessionid')?.session), { timeout: 10_000 }).toBeDefined();
    await new Promise((r) => setTimeout(r, 800));
    await chiudiSchede(app, 'a.localhost');
    await pulisci(app);
    expect((await cookieDiB(app)).map((c) => c.name)).toContain('sessionid');
  } finally { await srv.chiudi(); }
});

test('r2 — aprire la home di un sito col modulo d\'accesso, senza entrare, non lo segna fra i siti dove sei entrato', async ({ app, openTab }) => {
  const srv = await serve();
  try {
    const p = await openTab(srv.homeB);
    await p.waitForSelector('#pw');
    await expect.poll(() => cookieDiB(app).then((l) => l.map((c) => c.name)), { timeout: 10_000 }).toContain('_session_id');
    await new Promise((r) => setTimeout(r, 1000));
    const logged = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.loggedSites);
    expect(logged).not.toContain('b.localhost');
  } finally { await srv.chiudi(); }
});
