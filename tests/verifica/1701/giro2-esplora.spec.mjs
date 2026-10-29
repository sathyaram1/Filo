// Verifica #1701 giro 2: esplorazione, il colore del sito con le regole di sicurezza dei siti (CSP).

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const ICONA = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#e02020"/></svg>';

async function conServer(csp, corpo) {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/icona.svg')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(ICONA);
      return;
    }
    const h = { 'Content-Type': 'text/html; charset=utf-8' };
    if (csp) h['Content-Security-Policy'] = csp;
    res.writeHead(200, h);
    res.end(corpo || '<title>Sito</title><link rel="icon" href="/icona.svg"><h1>Notizie</h1><p>Articolo</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

for (const [nome, csp] of [
  ['senza regole', null],
  ['img-src self, senza blob', "default-src 'self'; img-src 'self'"],
  ['connect-src none', "connect-src 'none'"],
  ['default-src self', "default-src 'self'"],
]) {
  test(`colore del sito con CSP: ${nome}`, async ({ app, shell }) => {
    const server = await conServer(csp);
    try {
      const id = await app.evaluate(({ BrowserWindow }, u) => {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
        return w._filoTabs.openTab(u, { activate: false });
      }, `http://127.0.0.1:${server.address().port}/`);
      const colore = () => app.evaluate(({ BrowserWindow }, tid) => {
        const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
        const t = w._filoTabs.tabs.find((x) => x.id === tid);
        return t ? t.identityColor || null : null;
      }, id);
      await expect.poll(colore, { timeout: 8_000, intervals: [200] }).not.toBe(null);
    } finally {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    }
  });
}
