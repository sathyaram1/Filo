import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const DATI = Buffer.from('dati di prova '.repeat(50));

for (const tema of ['light', 'dark']) {
  test(`aspetto della domanda, tema ${tema}`, async ({ app, shell, openTab }) => {
    test.setTimeout(90_000);
    const srv = createServer((req, res) => {
      if (req.url.startsWith('/file-')) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': DATI.length, 'Content-Disposition': `attachment; filename="${req.url.slice(1)}"` });
        res.end(DATI); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>Sito che scarica</title><body><h1>Ciao</h1><script>
        for (let i = 0; i < 4; i++) setTimeout(() => { const a = document.createElement('a'); a.href = '/file-' + i + '.bin'; a.download=''; document.body.appendChild(a); a.click(); }, 300 + i * 500);
      </script></body>`);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
      await openTab(`http://127.0.0.1:${srv.address().port}/`);
      await expect(shell.locator('#permesso-bar')).toBeVisible({ timeout: 15_000 });
      await new Promise((r) => setTimeout(r, 2_500));
      await shell.screenshot({ path: `tests/.shots/2294-v1-domanda-${tema}.png` });
      console.log('BARRA', await shell.locator('#permesso-bar').innerText());
    } finally {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    }
  });
}
