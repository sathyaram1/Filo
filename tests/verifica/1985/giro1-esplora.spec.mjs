// Verifica #1985, giro 1: le porte trovate provando il precarico dei link come un utente.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test.setTimeout(180_000);

// Un sito con l'accesso: il cookie della sessione arriva alla prima visita, e un GET sui percorsi di uscita la chiude
// sul server, come fanno davvero tanti siti.
async function sitoConAccesso(uscite) {
  const richieste = [];
  const sessioni = new Set();
  let prossima = 1;
  const server = createServer((req, res) => {
    const cookie = /sess=(\d+)/.exec(req.headers.cookie || '');
    const prefetch = /prefetch/.test(req.headers['sec-purpose'] || '');
    richieste.push({ url: req.url, prefetch, cookie: cookie ? cookie[1] : '' });
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    if (uscite.some((u) => u.href === req.url)) {
      if (cookie) sessioni.delete(cookie[1]);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>uscito</title><p>Sei uscito.</p>');
      return;
    }
    const extra = {};
    let id = cookie && sessioni.has(cookie[1]) ? cookie[1] : '';
    if (!cookie) { id = String(prossima++); sessioni.add(id); extra['Set-Cookie'] = `sess=${id}; Path=/; HttpOnly`; }
    const nav = uscite.map((u) => `<a href="${u.href}">${u.testo}</a>`).join(' ');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...extra });
    res.end(`<!doctype html><meta charset="utf-8"><title>area</title><body>
      <nav><a href="/area/profilo">Profilo</a> <a href="/area/ordini">Ordini</a> ${nav}</nav>
      <h1 id="stato">${id ? 'Ciao, sei dentro' : 'Accedi'}</h1></body>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    richieste,
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

for (const [nome, uscite] of [
  ['tedesco', [{ href: '/konto/abmelden', testo: 'Abmelden' }]],
  ['francese', [{ href: '/compte/deconnexion', testo: 'Se déconnecter' }]],
  ['parola composta', [{ href: '/user/doLogout', testo: 'Esci' }]],
]) {
  test(`r1 aprire la pagina non fa uscire dal sito: link di uscita ${nome}`, async ({ openTab }) => {
    const sito = await sitoConAccesso(uscite);
    try {
      const page = await openTab(`${sito.origin}/area`);
      await expect(page.locator('#stato')).toHaveText('Ciao, sei dentro');
      // Il tempo del precarico dei link a schermo: tre link in cima.
      await page.waitForTimeout(6000);
      await page.reload();
      await expect(page.locator('#stato')).toHaveText('Ciao, sei dentro');
    } finally { await sito.chiudi(); }
  });
}

// Un'app di una pagina sola: il clic cambia indirizzo con pushState e ridisegna venti link nuovi, senza ricaricare.
async function sitoAppUnaPagina() {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push({ url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || '') });
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>app</title><body style="margin:0"><div id="vista"></div>
      <script>
        function disegna() {
          const qui = location.pathname.split('/').pop() || 'v0';
          let h = '<h1 id="titolo">' + qui + '</h1>';
          for (let i = 0; i < 24; i++) h += '<a style="display:block;height:18px" id="l' + i + '" href="/app/' + qui + '-' + i + '">' + qui + ' ' + i + '</a>';
          document.getElementById('vista').innerHTML = h;
        }
        document.addEventListener('click', (e) => {
          const a = e.target.closest('a');
          if (!a) return;
          e.preventDefault();
          history.pushState({}, '', a.href);
          disegna();
        });
        disegna();
      </script></body>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    richieste,
    precarichi: () => richieste.filter((r) => r.prefetch).map((r) => r.url),
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

test('r2 in un\'app di una pagina sola il passaggio del mouse precarica ancora dopo qualche clic', async ({ openTab }) => {
  const sito = await sitoAppUnaPagina();
  try {
    const page = await openTab(`${sito.origin}/app/v0`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    for (let giro = 0; giro < 3; giro++) {
      await expect.poll(() => sito.precarichi().length, { timeout: 40_000, intervals: [500] }).toBeGreaterThanOrEqual(20 * (giro + 1));
      await page.click('#l0');
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(16_000);
    const prima = sito.precarichi().length;
    await page.hover('#l23');
    const atteso = await page.evaluate(() => new URL(document.getElementById('l23').href).pathname);
    await expect.poll(() => sito.precarichi(), { timeout: 5000 }).toContain(atteso);
    expect(prima).toBeGreaterThan(0);
  } finally { await sito.chiudi(); }
});

test('r3 dopo il clic su un link che scarica un file, i link a schermo riprendono', async ({ openTab }) => {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push({ url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || '') });
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    if (req.url === '/report') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="report.txt"' });
      res.end('ciao');
      return;
    }
    const sotto = Array.from({ length: 10 }, (_, i) => `<a style="display:block;height:18px" href="/giu/${i}">giu ${i}</a>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0"><a id="scarica" href="/report">Scarica il resoconto</a>
      <div style="height:3000px"></div><div id="sotto">${sotto}</div></body>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await openTab(`${origin}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.waitForTimeout(2000);
    await page.click('#scarica');
    await expect.poll(() => richieste.some((r) => r.url === '/report' && !r.prefetch), { timeout: 5000 }).toBe(true);
    await page.waitForTimeout(3000);
    await page.locator('#sotto').scrollIntoViewIfNeeded();
    await expect.poll(() => richieste.filter((r) => r.prefetch && r.url.startsWith('/giu/')).length, { timeout: 20_000, intervals: [500] })
      .toBeGreaterThan(0);
  } finally { await new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }); }
});
