// Esplorazione: quanto tarda il colore della scheda su un sito con un'immagine lenta.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test('colore della scheda con un\'immagine lenta nella pagina', async ({ app, openTab }) => {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/icona.svg')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#e02020"/></svg>');
      return;
    }
    if (req.url.startsWith('/lento.png')) { setTimeout(() => { res.writeHead(404); res.end(); }, 4000); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>Lento</title><link rel="icon" href="/icona.svg"><p>Ciao</p><img src="/lento.png">');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const t0 = Date.now();
    await openTab(`http://127.0.0.1:${server.address().port}/`);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).identityColor || null;
    }), { timeout: 15_000 }).not.toBe(null);
    console.log('COLORE DOPO ms', Date.now() - t0);
  } finally {
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});
