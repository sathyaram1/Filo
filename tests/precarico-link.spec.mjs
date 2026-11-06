import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

function sitoCheConta() {
  const richieste = [];
  const server = createServer((req, res) => {
    const r = { url: req.url, purpose: req.headers['sec-purpose'] || '', at: Date.now(), chiusa: false };
    richieste.push(r);
    if (req.url.startsWith('/indice')) {
      const links = Array.from({ length: 30 }, (_, i) => `<p style="height:60px"><a href="/p/${i}">link ${i}</a></p>`).join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>indice</title><body>${links}</body>`);
      return;
    }
    res.on('close', () => { if (!res.writableEnded) r.chiusa = Date.now(); });
    setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=0' });
      res.end(`<!doctype html><title>pagina ${req.url}</title><body>${req.url}</body>`);
      r.fine = Date.now();
    }, 2000);
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
      s.id = 'sr';
      s.type = 'speculationrules';
      s.textContent = JSON.stringify({ prefetch: [{ source: 'list', urls: [1, 2, 3, 4, 5].map((n) => `${o}/p/${n}`) }] });
      document.head.append(s);
    }, origin);
    await page.waitForTimeout(700);
    await page.evaluate((o) => {
      document.getElementById('sr').remove();
      const s = document.createElement('script');
      s.type = 'speculationrules';
      s.textContent = JSON.stringify({ prefetch: [{ source: 'list', urls: [1].map((n) => `${o}/p/${n}`) }] });
      document.head.append(s);
    }, origin);
    await page.waitForTimeout(3000);
    console.log('RICHIESTE', JSON.stringify(richieste.map((r) => ({ ...r, at: r.at - richieste[0].at, fine: r.fine && r.fine - richieste[0].at, chiusa: r.chiusa && r.chiusa - richieste[0].at }))));
  } finally { server.close(); }
});
