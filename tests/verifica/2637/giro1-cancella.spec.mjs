// #2637 giro 1: il riquadro che scrive il suo cookie e poi lo cancella, o lo riscrive di sessione, non deve
// ritrovarselo com'era: la riscrittura di Filo non rimette un valore che il sito ha già sostituito o tolto.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const ATTR = 'path=/; SameSite=None; Secure';

async function serve() {
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/rq') {
      const gap = Number(u.searchParams.get('gap') || 0);
      const passi = [
        `document.cookie = "via${gap}=1; max-age=3600; ${ATTR}";`,
        `document.cookie = "via${gap}=; max-age=0; ${ATTR}";`,
        `document.cookie = "ses${gap}=1; max-age=3600; ${ATTR}";`,
        `document.cookie = "ses${gap}=2; ${ATTR}";`,
      ];
      const js = gap ? `${passi[0]}${passi[2]}setTimeout(() => { ${passi[1]}${passi[3]} }, ${gap});` : passi.join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<p>riquadro</p><script>${js}</script>`);
      return;
    }
    const porta = server.address().port;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>ARTICOLO</title><p>articolo</p>' + [0, 10, 40].map((g) => `<iframe width="80" height="40" src="http://b.localhost:${porta}/rq?gap=${g}"></iframe>`).join(''));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  return {
    pagina: `http://a.localhost:${porta}/`,
    async chiudi() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

const stati = (app) => app.evaluate(async ({ session }) => {
  const lista = await session.defaultSession.cookies.get({ domain: 'b.localhost' });
  return lista.map((c) => `${c.name}=${c.value}:${c.session ? 'sessione' : 'scadenza'}`).sort();
});

for (let giro = 1; giro <= 3; giro++) {
  test(`il cookie cancellato dal riquadro non torna, quello riscritto di sessione resta il nuovo (giro ${giro})`, async ({ app, openTab }) => {
    const srv = await serve();
    try {
      await openTab(srv.pagina);
      const atteso = ['ses0=2:sessione', 'ses10=2:sessione', 'ses40=2:sessione'];
      await expect.poll(() => stati(app), { timeout: 10_000 }).toEqual(atteso);
      await new Promise((r) => setTimeout(r, 1500));
      expect(await stati(app)).toEqual(atteso);
    } finally {
      await srv.chiudi();
    }
  });
}
