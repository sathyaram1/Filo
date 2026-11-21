// #2637 giro 1: la corsa resa sicura. La scrittura di Filo che rende il cookie di sessione si fa arrivare in ritardo,
// dopo che il riquadro ha già cambiato il suo cookie: deve vincere quello che il riquadro ha scritto per ultimo.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const ATTR = 'path=/; SameSite=None; Secure';

async function serve(js) {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/rq')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<p>riquadro</p><script>${js}</script>`);
      return;
    }
    const porta = server.address().port;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<title>ARTICOLO</title><p>articolo</p><iframe width="80" height="40" src="http://b.localhost:${porta}/rq"></iframe>`);
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

// Ogni scrittura fatta dal processo principale arriva 80 ms dopo la richiesta: la lettura che la precede vede ancora
// il valore vecchio, e il riquadro intanto lo cambia.
const rallentaScritture = (app) => app.evaluate(({ session }) => {
  const ck = session.defaultSession.cookies;
  if (ck.__lento) return;
  const orig = ck.set.bind(ck);
  ck.set = async (d) => { await new Promise((r) => setTimeout(r, 80)); return orig(d); };
  ck.__lento = true;
});

const stati = (app) => app.evaluate(async ({ session }) => {
  const lista = await session.defaultSession.cookies.get({ domain: 'b.localhost' });
  return lista.map((c) => `${c.name}=${c.value}:${c.session ? 'sessione' : 'scadenza'}`).sort();
});

const CASI = [
  { titolo: 'riscritto con scadenza', js: `document.cookie = "stato=1; max-age=3600; ${ATTR}"; setTimeout(() => { document.cookie = "stato=2; max-age=3600; ${ATTR}"; }, 20);`, atteso: ['stato=2:sessione'] },
  { titolo: 'riscritto di sessione', js: `document.cookie = "stato=1; max-age=3600; ${ATTR}"; setTimeout(() => { document.cookie = "stato=2; ${ATTR}"; }, 20);`, atteso: ['stato=2:sessione'] },
];

for (const caso of CASI) {
  test(`con la scrittura di Filo in ritardo, il cookie del riquadro ${caso.titolo} subito dopo resta come l'ha lasciato il riquadro`, async ({ app, openTab }) => {
    await rallentaScritture(app);
    const srv = await serve(caso.js);
    try {
      await openTab(srv.pagina);
      await new Promise((r) => setTimeout(r, 2500));
      await expect.poll(() => stati(app), { timeout: 8_000 }).toEqual(caso.atteso);
      await new Promise((r) => setTimeout(r, 1000));
      expect(await stati(app)).toEqual(caso.atteso);
    } finally {
      await srv.chiudi();
    }
  });
}
