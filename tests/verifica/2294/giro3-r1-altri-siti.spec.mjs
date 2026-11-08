// Verifica #2294 giro 3: una pagina che salta da sola fra siti diversi (domini registrati diversi, come i sottodomini
// gratuiti di un servizio di pagine o gli indirizzi IP) riparte da capo a ogni salto, e ogni file arriva in Download.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readdirSync, existsSync } from 'node:fs';

const SITI = [0, 1, 2, 3, 4, 5].map((i) => `sito${i}.test`);
test.use({ hostInPiu: SITI });

const DATI = Buffer.from('dati di prova '.repeat(20));

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
    const dopo = n + 1 < SITI.length ? `http://${SITI[n + 1]}:${porta}/salta?n=${n + 1}` : '';
    const corpo = `<h1>Pagina ${n}</h1><script>
      setTimeout(() => { const a = document.createElement('a'); a.href = '/file-altrosito-${n}.bin'; a.download = ''; document.body.appendChild(a); a.click(); }, 200);
      ${dopo ? `setTimeout(() => { location.href = ${JSON.stringify(dopo)}; }, 1500);` : ''}
    </script>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Salta</title></head><body>${corpo}</body></html>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { porta: srv.address().port, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const arrivati = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.includes('altrosito')) : []);
const visti = (shell) => shell.evaluate(async () => {
  const r = await window.filoShell.downloads.list();
  return ((r && r.items) || []).filter((it) => String(it.filename || '').includes('altrosito')).length;
});

test('r1 una pagina che salta da sola fra sei siti diversi, senza clic: arriva il primo file, gli altri aspettano la domanda', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    await openTab(`http://${SITI[0]}:${srv.porta}/salta?n=0`);
    await expect.poll(() => visti(shell), { timeout: 40_000 }).toBe(SITI.length);
    await expect.poll(() => arrivati(dir).length, { timeout: 5_000 }).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(arrivati(dir).sort(), 'file arrivati in Download senza nessun clic').toEqual(['file-altrosito-0.bin']);
  } finally {
    await srv.close();
  }
});
