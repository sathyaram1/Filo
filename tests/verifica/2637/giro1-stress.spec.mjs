// #2637 giro 1: il riquadro che riscrive più volte di fila il suo cookie deve tenere l'ultimo valore, di sessione,
// anche con più riquadri insieme, tre scritture, scritture distanziate e intestazione più script.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const ATTR = 'path=/; SameSite=None; Secure';

function scriptScritture(nome, valori, gap) {
  if (!gap) return valori.map((v) => `document.cookie = "${nome}=${v}; max-age=3600; ${ATTR}";`).join('');
  return valori.map((v, i) => `setTimeout(() => { document.cookie = "${nome}=${v}; max-age=3600; ${ATTR}"; }, ${i * gap});`).join('');
}

async function serve(riquadri) {
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/rq') {
      const nome = u.searchParams.get('nome');
      const valori = u.searchParams.get('v').split(',');
      const gap = Number(u.searchParams.get('gap') || 0);
      const intest = u.searchParams.get('h');
      const h = { 'Content-Type': 'text/html; charset=utf-8' };
      if (intest) h['Set-Cookie'] = [`${nome}=${intest}; Max-Age=3600; Path=/; SameSite=None; Secure`];
      res.writeHead(200, h);
      res.end(`<p>riquadro</p><script>${scriptScritture(nome, valori, gap)}</script>`);
      return;
    }
    const porta = server.address().port;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>ARTICOLO</title><p>articolo</p>' + riquadri.map((q) => `<iframe width="80" height="40" src="http://b.localhost:${porta}/rq?${q}"></iframe>`).join(''));
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

const stati = (app, nomi) => app.evaluate(async ({ session }, n) => {
  const lista = await session.defaultSession.cookies.get({ domain: 'b.localhost' });
  const out = {};
  for (const x of n) out[x] = lista.filter((c) => c.name === x).map((c) => `${c.value}:${c.session ? 'sessione' : 'scadenza'}`).sort().join(' ');
  return out;
}, nomi);

const CASI = [
  { q: 'nome=d1&v=1,2', atteso: '2' },
  { q: 'nome=d2&v=1,2', atteso: '2' },
  { q: 'nome=d3&v=1,2', atteso: '2' },
  { q: 'nome=d4&v=1,2', atteso: '2' },
  { q: 'nome=t1&v=1,2,3', atteso: '3' },
  { q: 'nome=t2&v=a,b,c,d,e', atteso: 'e' },
  { q: 'nome=g5&v=1,2,3&gap=5', atteso: '3' },
  { q: 'nome=g20&v=1,2&gap=20', atteso: '2' },
  { q: 'nome=g60&v=1,2,3&gap=60', atteso: '3' },
  { q: 'nome=hs&h=0&v=1', atteso: '1' },
  { q: 'nome=hs2&h=0&v=1,2', atteso: '2' },
];

for (let giro = 1; giro <= 3; giro++) {
  test(`più riquadri che riscrivono di fila i loro cookie tengono tutti l'ultimo valore, di sessione (giro ${giro})`, async ({ app, openTab }) => {
    const srv = await serve(CASI.map((c) => c.q));
    try {
      const page = await openTab(srv.pagina);
      const nomi = CASI.map((c) => new URLSearchParams(c.q).get('nome'));
      const atteso = Object.fromEntries(CASI.map((c, i) => [nomi[i], `${c.atteso}:sessione`]));
      await expect.poll(() => stati(app, nomi), { timeout: 10_000 }).toEqual(atteso);
      await new Promise((r) => setTimeout(r, 1500));
      expect(await stati(app, nomi)).toEqual(atteso);
      const visti = [];
      for (const f of page.frames().filter((x) => x.url().includes('b.localhost'))) visti.push(await f.evaluate(() => document.cookie));
      for (const [n, v] of Object.entries(atteso)) expect(visti.some((d) => d.split('; ').includes(`${n}=${v.split(':')[0]}`)), n).toBe(true);
    } finally {
      await srv.chiudi();
    }
  });
}
