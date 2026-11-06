// Verifica #1985, giro 1, rilievo 1: aprire una pagina con un link di uscita a schermo non deve far uscire dal sito.
// Il sito chiude la sessione a un GET sul percorso di uscita, come tanti siti veri; i percorsi qui non sono inglesi.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function sitoConAccesso(uscita) {
  const richieste = [];
  const sessioni = new Set();
  let prossima = 1;
  const server = createServer((req, res) => {
    const cookie = /sess=(\d+)/.exec(req.headers.cookie || '');
    richieste.push({ url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || '') });
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    if (req.url === uscita.href) {
      if (cookie) sessioni.delete(cookie[1]);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>uscito</title><p>Sei uscito.</p>');
      return;
    }
    const extra = {};
    let id = cookie && sessioni.has(cookie[1]) ? cookie[1] : '';
    if (!cookie) { id = String(prossima++); sessioni.add(id); extra['Set-Cookie'] = `sess=${id}; Path=/; HttpOnly`; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...extra });
    res.end(`<!doctype html><meta charset="utf-8"><title>area</title><body>
      <nav><a href="/area/profilo">Profilo</a> <a href="/area/ordini">Ordini</a> <a href="${uscita.href}">${uscita.testo}</a></nav>
      <h1 id="stato">${id ? 'Ciao, sei dentro' : 'Accedi'}</h1></body>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    richieste,
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

for (const [nome, uscita] of [
  ['tedesco', { href: '/konto/abmelden', testo: 'Abmelden' }],
  ['francese', { href: '/compte/deconnexion', testo: 'Se déconnecter' }],
  ['parola composta', { href: '/user/doLogout', testo: 'Esci' }],
]) {
  test(`r1 aprire la pagina non fa uscire dal sito: link di uscita ${nome}`, async ({ openTab }) => {
    const sito = await sitoConAccesso(uscita);
    try {
      const page = await openTab(`${sito.origin}/area`);
      await expect(page.locator('#stato')).toHaveText('Ciao, sei dentro');
      // Il tempo dei link a schermo: tre link in cima, a rete ferma.
      await page.waitForTimeout(6000);
      expect(sito.richieste.filter((r) => r.url === uscita.href).map((r) => (r.prefetch ? 'precarico' : 'visita'))).toEqual([]);
      await page.reload();
      await expect(page.locator('#stato')).toHaveText('Ciao, sei dentro');
    } finally { await sito.chiudi(); }
  });
}
