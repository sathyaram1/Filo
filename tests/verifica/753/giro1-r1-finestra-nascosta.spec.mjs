// Verifica #753 giro 1, rilievo 1: la finestra nascosta che pre-apre un link sospetto deve nascere protetta come la scheda.
// Link http aperto in incognito: ogni caricamento della pagina porta Sec-GPC e ogni richiesta al tracker viene bloccata.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test('link sospetto aperto in incognito: anche il pre-caricamento nascosto manda GPC e blocca i tracker', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const caricamenti = [];
  const server = createServer((req, res) => {
    if (req.url.startsWith('/d')) caricamenti.push(req.headers['sec-gpc'] ?? 'assente');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>D</title><script src="https://www.google-analytics.com/analytics.js"></script></head><body>d</body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await app.evaluate(({ app: a, session }) => {
      globalThis.__ga = [];
      const aggancia = (ses) => {
        ses.webRequest.onErrorOccurred({ urls: ['*://*.google-analytics.com/*'] }, (d) => globalThis.__ga.push(d.error));
        ses.webRequest.onCompleted({ urls: ['*://*.google-analytics.com/*'] }, (d) => globalThis.__ga.push(`caricato ${d.statusCode}`));
      };
      aggancia(session.defaultSession);
      a.on('session-created', aggancia);
    });
    await shell.evaluate(() => window.filoShell.openIncognito());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoTabs && w._filoTabs.incognito))).toBe(true);
    const url = `http://127.0.0.1:${server.address().port}/d`;
    await app.evaluate(({ BrowserWindow }, u) => {
      BrowserWindow.getAllWindows().find((w) => w._filoTabs && w._filoTabs.incognito)._filoTabs.openTab(u);
    }, url);
    // Il pre-caricamento nascosto è il secondo caricamento della stessa pagina.
    await expect.poll(() => caricamenti.length, { timeout: 20_000 }).toBeGreaterThan(1);
    await expect.poll(() => app.evaluate(() => globalThis.__ga.length), { timeout: 15_000 }).toBeGreaterThan(1);
    await new Promise((r) => setTimeout(r, 1500));
    const ga = await app.evaluate(() => globalThis.__ga);
    expect(caricamenti.filter((g) => g !== '1'), `caricamenti: ${JSON.stringify(caricamenti)}`).toEqual([]);
    expect(ga.filter((e) => e !== 'net::ERR_BLOCKED_BY_CLIENT'), `tracker: ${JSON.stringify(ga)}`).toEqual([]);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});
