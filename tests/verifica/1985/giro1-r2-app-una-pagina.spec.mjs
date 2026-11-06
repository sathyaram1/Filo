// Verifica #1985, giro 1, rilievo 2: in un sito che cambia indirizzo senza ricaricare (app di una pagina sola), dopo
// qualche clic il passaggio del mouse deve ancora precaricare il link.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test.setTimeout(150_000);

test('r2 in un\'app di una pagina sola il passaggio del mouse precarica ancora dopo qualche clic', async ({ openTab }) => {
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  const precarichi = () => richieste.filter((r) => r.prefetch).map((r) => r.url);
  try {
    const page = await openTab(`${origin}/app/v0`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    // Tre vie dell'app, ognuna col tempo per i suoi link a schermo.
    for (let via = 0; via < 3; via++) {
      await page.waitForTimeout(18_000);
      await page.click('#l0');
    }
    await page.waitForTimeout(18_000);
    const atteso = await page.evaluate(() => new URL(document.getElementById('l23').href).pathname);
    await page.hover('#l23');
    await expect.poll(precarichi, { timeout: 5000 }).toContain(atteso);
  } finally { await new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }); }
});
