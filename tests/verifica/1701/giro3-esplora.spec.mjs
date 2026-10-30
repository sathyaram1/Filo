// Esplorazione verifica #1701 giro 3: colore del sito con una politica di sicurezza dei contenuti e icona su un altro dominio.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#e02020"/></svg>';

const coloreAttiva = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.identityColor || null;
});

async function servi(handler) {
  const s = createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return s;
}
async function chiudi(s) { try { s.closeAllConnections?.(); } catch (_) {} await new Promise((r) => s.close(r)); }

for (const [nome, csp] of [
  ['senza politica', ''],
  ['img-src self', "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'"],
  ['img-src self https data', "img-src 'self' data: https:"],
]) {
  test(`icona dello stesso sito, ${nome}`, async ({ app, openTab }) => {
    const s = await servi((req, res) => {
      if (req.url.startsWith('/icona.svg')) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end(SVG); return; }
      const h = { 'Content-Type': 'text/html; charset=utf-8' };
      if (csp) h['Content-Security-Policy'] = csp;
      res.writeHead(200, h);
      res.end('<title>X</title><link rel="icon" href="/icona.svg"><p>Ciao</p>');
    });
    try {
      await openTab(`http://127.0.0.1:${s.address().port}/`);
      await expect.poll(() => coloreAttiva(app), { timeout: 6_000 }).not.toBe(null);
    } finally { await chiudi(s); }
  });
}

test('icona su un altro dominio con CORS e connect-src self', async ({ app, openTab }) => {
  const cdn = await servi((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': '*' }); res.end(SVG);
  });
  const s = await servi((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `connect-src 'self'; img-src 'self' http://localhost:${cdn.address().port}` });
    res.end(`<title>X</title><link rel="icon" href="http://localhost:${cdn.address().port}/icona.svg"><p>Ciao</p>`);
  });
  try {
    await openTab(`http://127.0.0.1:${s.address().port}/`);
    await expect.poll(() => coloreAttiva(app), { timeout: 6_000 }).not.toBe(null);
  } finally { await chiudi(s); await chiudi(cdn); }
});
