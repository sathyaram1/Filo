// #1456 giro 1, rilievo 1: il colore della scheda non aspetta la fine del caricamento di una pagina lenta.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test('r1 su un sito con un\'immagine lenta il colore della scheda arriva prima che la pagina finisca di caricarsi', async ({ app, openTab }) => {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/icona.svg')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#e02020"/></svg>');
      return;
    }
    // Un'immagine che arriva dopo 8 s: la pagina resta in caricamento per tutto quel tempo, come un sito pieno di pubblicità.
    if (req.url.startsWith('/lento.png')) { setTimeout(() => { res.writeHead(404); res.end(); }, 8000); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>Lento</title><link rel="icon" href="/icona.svg"><p>Ciao</p><img src="/lento.png">');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await openTab(`http://127.0.0.1:${server.address().port}/`);
    // Su main il colore arriva in circa un secondo; qui deve arrivare ben prima che l'immagine lenta risponda.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).identityColor || null;
    }), { timeout: 4_000 }).not.toBe(null);
  } finally {
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});
