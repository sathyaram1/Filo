// r1: la finestra incognito (sessione sempre nuova) deve mandare al sito gli stessi client hints di una scheda normale.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test('r1 nella finestra incognito la pagina riceve i client hints come in una scheda normale', async ({ app, shell }) => {
  const viste = new Map();
  const server = createServer((req, res) => {
    if (!viste.has(req.url)) viste.set(req.url, { ...req.headers });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>INCOGNITO</title><p>ok</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/pagina-incognito`;
    await shell.evaluate(() => window.filoShell.openIncognito());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
      return w && w._filoTabs ? w._filoTabs.tabs.length : 0;
    }), { timeout: 15_000 }).toBe(1);
    await app.evaluate(({ BrowserWindow }, u) => {
      BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u);
    }, url);
    await expect.poll(() => viste.has('/pagina-incognito'), { timeout: 10_000 }).toBe(true);
    const h = viste.get('/pagina-incognito');
    expect(h['sec-ch-ua'], 'la richiesta della pagina in incognito non porta Sec-CH-UA').toMatch(/"Chromium";v="\d+"/);
    expect(h['sec-ch-ua-mobile']).toBe('?0');
    expect(h['sec-ch-ua-platform']).toMatch(/^"(Windows|macOS|Linux)"$/);
  } finally { server.close(); }
});
