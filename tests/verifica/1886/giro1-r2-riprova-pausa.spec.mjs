// Verifica #1886 giro 1, rilievo 2: lo scaricamento ripartito con «Riprova» si mette in pausa come quello partito dal
// clic, anche quando ricorda la pagina di provenienza.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const PEZZO = Buffer.alloc(64 * 1024, 7);
const TOTALE = PEZZO.length * 800;

test('r2 «Riprova» di un file grosso: la riga in corso ha «Pausa», come al primo tentativo', async ({ shell, openTab }) => {
  test.setTimeout(90_000);
  let colpi = 0;
  const aperte = new Set();
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/pagina') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body style="padding:40px"><a id="l" download href="/archivio.iso">archivio</a></body></html>');
      return;
    }
    if (u.pathname !== '/archivio.iso') { res.writeHead(404); res.end(); return; }
    if (++colpi === 1) { res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('occupato'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': TOTALE, 'Content-Disposition': 'attachment; filename="archivio.iso"' });
    const t = setInterval(() => { if (!res.destroyed) res.write(PEZZO); }, 250);
    aperte.add(t);
    res.on('close', () => { clearInterval(t); aperte.delete(t); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const page = await openTab(`${base}/pagina`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.locator('#l').click();
    await expect.poll(async () => ((((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [])
      .find((x) => x.url.endsWith('/archivio.iso')) || {}).state, { timeout: 30000 }).toBe('interrupted');
    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'archivio.iso' }) });
    await riga.locator('.dl-btn', { hasText: 'Riprova' }).click();
    await expect.poll(async () => ((((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [])
      .find((x) => x.url.endsWith('/archivio.iso')) || {}).receivedBytes || 0, { timeout: 20000 }).toBeGreaterThan(0);
    await expect(riga.locator('.dl-btn', { hasText: 'Pausa' })).toBeVisible({ timeout: 10000 });
  } finally {
    for (const t of aperte) clearInterval(t);
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});
