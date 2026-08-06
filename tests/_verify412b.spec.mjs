// VERIFICA #412 — sonda mirata: chiudere la scheda-contenitore NON deve
// interrompere lo scaricamento che quella scheda ha avviato.
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

test.setTimeout(180_000);

async function srvSlow(sizeKB, chunkKB, delayMs) {
  const BODY = Buffer.alloc(sizeKB * 1024, 0x50);
  let hits = 0;
  const server = createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/p') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>Partenza</title><body><a id="dl" href="/lento.bin" target="_blank">Scarica</a></body>');
      return;
    }
    if (u === '/lento.bin') {
      hits += 1;
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(BODY.length),
        'Content-Disposition': 'attachment; filename="lento.bin"',
      });
      let off = 0;
      const tick = () => {
        if (res.destroyed) return;
        if (off >= BODY.length) { res.end(); return; }
        res.write(BODY.subarray(off, off + chunkKB * 1024));
        off += chunkKB * 1024;
        setTimeout(tick, delayMs);
      };
      tick();
      return;
    }
    res.writeHead(404); res.end('x');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    BODY,
    origin: `http://127.0.0.1:${server.address().port}`,
    hits: () => hits,
    close: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }),
  };
}

const dlDir = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
const snap = (shell) => shell.evaluate(() => window.filoShell.tabs.snapshot());

test('A) download LENTO avviato da scheda-contenitore: la scheda si chiude ma il file arriva INTERO', async ({ app, shell, openTab }) => {
  const srv = await srvSlow(1024, 32, 120); // 1MB a fette da 32KB ogni 120ms ≈ 4s
  try {
    const page = await openTab(`${srv.origin}/p`);
    const before = await snap(shell);
    await page.click('#dl');

    // La scheda vuota sparisce quasi subito, mentre il download è ancora in corso.
    await expect.poll(async () => (await snap(shell)).tabs.length, { timeout: 20000 }).toBe(before.tabs.length);
    const dir = await dlDir(app);
    const target = join(dir, 'lento.bin');

    // ...e nonostante la chiusura, il file arriva COMPLETO.
    await expect.poll(() => (existsSync(target) ? statSync(target).size : -1), { timeout: 60000 }).toBe(srv.BODY.length);

    const items = await shell.evaluate(() => window.filoShell.downloads.list());
    const rec = (items.items || []).find((r) => r.filename === 'lento.bin');
    console.log('record:', JSON.stringify(rec && { s: rec.state, r: rec.receivedBytes, t: rec.totalBytes }));
    expect(rec.state).toBe('completed');
    expect(rec.receivedBytes).toBe(srv.BODY.length);
  } finally { await srv.close(); }
});

test('B) tre download LENTI in raffica da schede-contenitore: tutti e tre arrivano interi', async ({ app, shell, openTab }) => {
  const srv = await srvSlow(512, 32, 100);
  try {
    const page = await openTab(`${srv.origin}/p`);
    const before = await snap(shell);
    await page.evaluate(() => { const a = document.getElementById('dl'); a.click(); a.click(); a.click(); });

    const dir = await dlDir(app);
    await expect.poll(() => {
      try { return readdirSync(dir).filter((f) => f.startsWith('lento')).length; } catch (_) { return 0; }
    }, { timeout: 60000 }).toBe(srv.hits());

    await shell.waitForTimeout(6000);
    const files = readdirSync(dir).filter((f) => f.startsWith('lento'));
    const sizes = files.map((f) => statSync(join(dir, f)).size);
    console.log('richieste:', srv.hits(), 'file:', files, 'dimensioni:', sizes);
    expect(files.length, 'download persi per strada').toBe(srv.hits());
    for (const s of sizes) expect(s).toBe(srv.BODY.length);

    const after = await snap(shell);
    console.log('schede:', JSON.stringify(after.tabs.map((t) => t.url)));
    expect(after.tabs.length).toBe(before.tabs.length);
  } finally { await srv.close(); }
});
