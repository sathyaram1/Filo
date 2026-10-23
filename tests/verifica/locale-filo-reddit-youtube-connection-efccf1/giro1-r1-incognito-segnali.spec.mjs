// r1: nella finestra in incognito le pagine non ricevono i segnali del browser (Sec-CH-UA*) che le finestre normali
// ricevono; sono quelli senza cui Google respinge l'accesso in un profilo nuovo, e l'incognito è sempre un profilo nuovo.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test.setTimeout(120_000);

test('r1 una pagina aperta nella finestra in incognito riceve gli stessi segnali del browser di una finestra normale', async ({ app, shell, openTab }) => {
  const visti = new Map();
  const srv = createServer((req, res) => {
    visti.set(req.url.split('?')[0], req.headers);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>SEGNALI</title><p>ok</p>');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const segnali = (h) => h && { ua: h['sec-ch-ua'] || null, mobile: h['sec-ch-ua-mobile'] || null, piattaforma: h['sec-ch-ua-platform'] || null };
  try {
    const normale = await openTab(`${origin}/normale`);
    await normale.waitForLoadState('load');
    const attesi = segnali(visti.get('/normale'));
    expect(attesi.ua, 'nella finestra normale i segnali arrivano').toMatch(/Chromium/);

    await shell.evaluate(() => window.filoShell.openIncognito());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
      return w && w._filoTabs ? w._filoTabs.tabs.length : 0;
    }), { timeout: 20_000 }).toBeGreaterThan(0);
    const url = `${origin}/incognito`;
    await app.evaluate(({ BrowserWindow }, u) => {
      BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u);
    }, url);
    await expect.poll(() => visti.has('/incognito'), { timeout: 20_000 }).toBe(true);
    expect(segnali(visti.get('/incognito'))).toEqual(attesi);
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});
