// Verifica #2294 giro 4: con i cookie in Privacy ogni sito nuovo ricrea la scheda, e il conto dei file senza clic
// riparte da capo: una pagina che salta da sola fra siti diversi fa arrivare ogni file.
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
    const porta = srv.address().port;
    const n = Number(u.searchParams.get('n') || 0);
    const dopo = n + 1 < SITI.length ? `http://${SITI[n + 1]}:${porta}/salta?n=${n + 1}` : '';
    const corpo = `<h1>Pagina ${n}</h1><script>
      setTimeout(() => { const a = document.createElement('a'); a.href = '/file-privacy-${n}.bin'; a.download = ''; document.body.appendChild(a); a.click(); }, 200);
      ${dopo ? `setTimeout(() => { location.href = ${JSON.stringify(dopo)}; }, 1500);` : ''}
    </script>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Salta</title></head><body>${corpo}</body></html>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { porta: srv.address().port, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const arrivati = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.includes('privacy')) : []);
const visti = (shell) => shell.evaluate(async () => {
  const r = await window.filoShell.downloads.list();
  return ((r && r.items) || []).filter((it) => String(it.filename || '').includes('privacy')).length;
});

test('r1 con i cookie in Privacy una pagina che salta da sola fra sei siti, senza clic: arriva solo il primo file', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: [] } } } }));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.cookieMode === 'privacy')), { timeout: 5000 }).toBe(true);
  const srv = await apriServer();
  try {
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    await openTab(`http://${SITI[0]}:${srv.porta}/salta?n=0`);
    await expect.poll(() => visti(shell), { timeout: 40_000 }).toBe(SITI.length);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(arrivati(dir).sort(), 'file arrivati in Download senza nessun clic').toEqual(['file-privacy-0.bin']);
  } finally {
    await srv.close();
  }
});
