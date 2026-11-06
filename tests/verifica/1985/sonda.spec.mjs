import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function sito(ritardo) {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push({ url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || ''), t: Date.now() });
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    if (req.url === '/pag') {
      const links = Array.from({ length: 10 }, (_, i) => `<a id="l${i}" style="display:block;height:18px" href="/pag/${i}">link ${i}</a>`).join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0">${links}</body>`);
      return;
    }
    setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><h1 id="arrivato">${req.url}</h1>`);
    }, ritardo);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { origin: `http://127.0.0.1:${server.address().port}`, richieste, chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }) };
}

for (const premuto of [0, 150, 400]) {
  test(`pressione veloce, tenuto ${premuto} ms`, async ({ app, openTab }) => {
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ precarico: { visibili: false } }); });
    const s = await sito(1500);
    try {
      const page = await openTab(`${s.origin}/pag`);
      await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
      const box = await page.locator('#l3').boundingBox();
      await page.mouse.move(box.x + 5, box.y + 5);
      const t0 = Date.now();
      await page.mouse.down();
      await page.waitForTimeout(premuto);
      const primaDelClic = s.richieste.filter((x) => x.url === '/pag/3').length;
      await page.mouse.up();
      await expect(page.locator('#arrivato')).toHaveText('/pag/3', { timeout: 15_000 });
      console.log('PRESSIONE', premuto, Date.now() - t0, 'prima', primaDelClic, s.richieste.filter((x) => x.url === '/pag/3').map((x) => (x.prefetch ? 'P' : 'N')).join(''));
    } finally { await s.chiudi(); }
  });
}
