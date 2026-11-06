// #1985 giro 3, r1: un link a schermo il cui precarico è ancora in corso al clic va usato, non aspettato e poi buttato.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test('r1 su un sito lento il clic su un link a schermo in precarico usa quel precarico, e la pagina arriva prima', async ({ openTab }) => {
  const RITARDO = 2000;
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push({ url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || '') });
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    const html = (body) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0">${body}</body>`);
    };
    if (req.url === '/indice') {
      html(Array.from({ length: 10 }, (_, i) => `<a id="l${i}" style="display:block;height:18px" href="/p/${i}">link ${i}</a>`).join(''));
      return;
    }
    setTimeout(() => { if (!res.destroyed) html(`<h1 id="arrivato">${req.url}</h1>`); }, req.url === '/p/0' ? RITARDO : 0);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const page = await openTab(`http://127.0.0.1:${server.address().port}/indice`);
    // Il primo link a schermo parte da solo a pagina ferma; lo si clicca mentre il sito sta ancora rispondendo.
    await expect.poll(() => richieste.some((r) => r.url === '/p/0' && r.prefetch), { timeout: 30_000, intervals: [100] }).toBe(true);
    await page.waitForTimeout(200);
    const t0 = Date.now();
    await page.click('#l0', { noWaitAfter: true });
    await expect(page.locator('#arrivato')).toHaveText('/p/0', { timeout: 15_000 });
    const attesa = Date.now() - t0;
    expect(richieste.filter((r) => r.url === '/p/0').map((r) => r.prefetch)).toEqual([true]);
    expect(attesa).toBeLessThan(RITARDO + 600);
  } finally { await new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }); }
});
