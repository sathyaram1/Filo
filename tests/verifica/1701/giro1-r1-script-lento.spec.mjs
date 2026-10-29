// Verifica #1701 giro 1, rilievo 1: su un sito lento il colore del sito arriva quando la pagina comincia a comparire,
// anche se a rallentarla è uno script a metà pagina e non un'immagine.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const ICONA = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#e02020"/></svg>';

test('r1 sito con uno script lento a metà pagina, aperto dietro: la barra tinge la scheda mentre la pagina si vede già', async ({ app, shell }) => {
  const tenute = [];
  const server = createServer((req, res) => {
    if (req.url.startsWith('/icona.svg')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(ICONA);
      return;
    }
    // Uno script di pubblicità che il sito manda dopo 8 s: titolo e articolo sopra di lui sono già a schermo.
    if (req.url.startsWith('/lento.js')) {
      tenute.push(res);
      setTimeout(() => { try { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(''); } catch (_) {} }, 8_000);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>Lento</title><link rel="icon" href="/icona.svg"><h1>Notizie</h1><p>Articolo</p><script src="/lento.js"></script><p>Fine</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const id = await app.evaluate(({ BrowserWindow }, u) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return w._filoTabs.openTab(u, { activate: false });
    }, `http://127.0.0.1:${server.address().port}/`);
    // Un sito veloce aperto dietro si tinge in poco più di un secondo: qui si concede il triplo.
    const tinta = () => shell.evaluate((tid) => {
      const el = document.querySelector(`.tab[data-id="${tid}"]`);
      return el ? el.style.getPropertyValue('--tab-bg-eff') || null : null;
    }, id);
    await expect.poll(tinta, { timeout: 3_500, intervals: [100] }).not.toBe(null);
  } finally {
    for (const r of tenute) { try { r.destroy(); } catch (_) {} }
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});
