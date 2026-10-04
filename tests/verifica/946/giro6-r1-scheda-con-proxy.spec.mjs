// #946 giro 6: in una scheda che passa da un proxy («apri dalla Francia»), i byte
// dell'immagine che Filo scarica per il tasto destro devono passare dallo stesso proxy.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, request } from 'node:http';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'provenienza');

function ascolta(server) {
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));
}

test('tasto destro su un’immagine in una scheda col proxy: il download non esce dal proxy', async ({ app, openTab, testServer }) => {
  const foto = readFileSync(join(FIXTURE, 'c2pa-ufficiale-ai.jpg'));
  const richieste = [];
  const cdn = createServer((req, res) => {
    richieste.push({ url: req.url, viaProxy: req.headers['x-via-proxy'] === '1', ua: req.headers['user-agent'] || '' });
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': foto.length });
    res.end(foto);
  });
  const proxy = createServer((req, res) => {
    const u = new URL(req.url);
    const inoltro = request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: { ...req.headers, 'x-via-proxy': '1' } }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    inoltro.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(inoltro);
  });
  const portaCdn = await ascolta(cdn);
  const portaProxy = await ascolta(proxy);
  try {
    const src = `http://localhost:${portaCdn}/foto.jpg`;
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
      <img id="foto" src="${src}" width="200" height="200"></body></html>`);
    const indirizzo = page.url();
    await app.evaluate(async ({ webContents }, { indirizzo, portaProxy }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === indirizzo);
      await wc.session.setProxy({ proxyRules: `http://127.0.0.1:${portaProxy}`, proxyBypassRules: '<-loopback>' });
      await wc.session.clearCache();
    }, { indirizzo, portaProxy });
    await page.reload();
    await page.waitForFunction(() => document.getElementById('foto').naturalWidth > 0);
    // La premessa: la pagina passa dal proxy.
    expect(richieste.length).toBeGreaterThan(0);
    expect(richieste.every((r) => r.viaProxy)).toBe(true);

    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    await expect(page.locator('.sn-menu .sn-menu-origine')).toHaveAttribute('aria-label', /Generata con l’AI/, { timeout: 10000 });
    const dirette = richieste.filter((r) => !r.viaProxy);
    expect(dirette, `richieste uscite senza proxy: ${JSON.stringify(dirette)}`).toEqual([]);
  } finally {
    cdn.close();
    proxy.close();
  }
});
