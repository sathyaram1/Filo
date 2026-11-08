// Verifica #2294 giro 1: il freno sui download senza un clic si aggira con un clic solo o cambiando sottodominio.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readdirSync, existsSync } from 'node:fs';

const HOST = ['a', 'b', 'c', 'd', 'e'].map((x) => `${x}.scarica.test`);
test.use({ hostInPiu: HOST });

const DATI = Buffer.from('dati di prova '.repeat(50));

// Pagine e file su qualunque nome: `/salta?n=K` scarica il file K e passa da sola al sottodominio dopo.
async function apriServer() {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/file-')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': DATI.length, 'Content-Disposition': `attachment; filename="${u.pathname.slice(1)}"` });
      res.end(DATI);
      return;
    }
    const n = Number(u.searchParams.get('n') || 0);
    const porta = srv.address().port;
    let corpo = '';
    if (u.pathname === '/salta') {
      const dopo = n + 1 < HOST.length ? `http://${HOST[n + 1]}:${porta}/salta?n=${n + 1}` : '';
      corpo = `<h1>Pagina ${n}</h1><script>
        setTimeout(() => { const a = document.createElement('a'); a.href = '/file-salto-${n}.bin'; a.download = ''; document.body.appendChild(a); a.click(); }, 300);
        ${dopo ? `setTimeout(() => { location.href = ${JSON.stringify(dopo)}; }, 1500);` : ''}
      </script>`;
    } else {
      corpo = `<button id="via" style="font-size:30px">Scarica il modulo</button><script>
        document.getElementById('via').onclick = () => {
          for (let i = 0; i < 6; i++) setTimeout(() => { const a = document.createElement('a'); a.href = '/file-raffica-' + i + '.bin'; a.download = ''; document.body.appendChild(a); a.click(); }, 200 + i * 400);
        };
      </script>`;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Scarica</title></head><body>${corpo}</body></html>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { porta: srv.address().port, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const cartella = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
const arrivati = (dir, segno) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.includes(segno)) : []);

test('r1 un clic solo sulla pagina: dei sei file che la pagina scarica da sé dopo il clic ne arriva uno, per gli altri si chiede', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    const page = await openTab(`http://${HOST[0]}:${srv.porta}/clic`);
    await page.locator('#via').click();
    await new Promise((r) => setTimeout(r, 4_500));
    const qui = arrivati(dir, 'raffica');
    await shell.screenshot({ path: 'tests/.shots/2294-v1-raffica.png' });
    expect(qui, `nella cartella Download: ${qui.join(', ')}`).toHaveLength(1);
    await expect(shell.locator('#permesso-bar')).toBeVisible();
  } finally {
    await srv.close();
  }
});

test('r1 una pagina che salta da un sottodominio all\'altro dello stesso sito, senza clic: arriva un file solo, per gli altri si chiede', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    const dir = await cartella(app);
    await openTab(`http://${HOST[0]}:${srv.porta}/salta?n=0`);
    await new Promise((r) => setTimeout(r, HOST.length * 1_500 + 2_500));
    const qui = arrivati(dir, 'salto');
    await shell.screenshot({ path: 'tests/.shots/2294-v1-salto.png' });
    expect(qui, `nella cartella Download: ${qui.join(', ')}`).toHaveLength(1);
  } finally {
    await srv.close();
  }
});
