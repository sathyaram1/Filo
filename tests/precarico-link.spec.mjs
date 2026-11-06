import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

function sitoCheConta() {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push({ url: req.url, purpose: req.headers['sec-purpose'] || '', at: Date.now() });
    if (req.url.startsWith('/indice')) {
      const links = Array.from({ length: 30 }, (_, i) => `<p style="height:60px"><a href="/p/${i}">link ${i}</a></p>`).join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>indice</title><body>${links}</body>`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=0' });
    res.end(`<!doctype html><title>pagina ${req.url}</title><body>${req.url}</body>`);
  });
  return { server, richieste };
}

test('esperimento: speculation rules in Electron', async ({ openTab }) => {
  const { server, richieste } = sitoCheConta();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await openTab(`${origin}/indice`);
    await page.evaluate((o) => {
      const s = document.createElement('script');
      s.type = 'speculationrules';
      s.textContent = JSON.stringify({ prefetch: [{ source: 'list', urls: [`${o}/p/1`, `${o}/p/2`] }] });
      document.head.append(s);
    }, origin);
    await page.waitForTimeout(2000);
    console.log('SUPPORTS', await page.evaluate(() => HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')));
    console.log('RICHIESTE', JSON.stringify(richieste));
    await page.click('a[href="/p/1"]');
    await page.waitForTimeout(1500);
    console.log('DOPO', JSON.stringify(richieste));
  } finally { server.close(); }
});
