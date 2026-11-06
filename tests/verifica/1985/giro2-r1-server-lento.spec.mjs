// #1985 giro 2, r1: con un server lento il precarico al passaggio del mouse non deve far aspettare il clic il doppio.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const RITARDO = 2000;

test('r1 con un server che risponde in due secondi, il clic dopo il passaggio usa il precarico e non chiede la pagina una seconda volta', async ({ app, openTab }) => {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push({ url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || '') });
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
    }, RITARDO);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    // Solo il passaggio del mouse: i link a schermo spenti, così conta un precarico solo.
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ precarico: { visibili: false } }); });
    const page = await openTab(`http://127.0.0.1:${server.address().port}/pag`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.hover('#l3');
    await page.waitForTimeout(300);
    const t0 = Date.now();
    await page.click('#l3', { noWaitAfter: true });
    await expect(page.locator('#arrivato')).toHaveText('/pag/3', { timeout: 15_000 });
    const attesa = Date.now() - t0;
    const volte = richieste.filter((r) => r.url === '/pag/3').map((r) => (r.prefetch ? 'precarico' : 'clic'));
    expect(volte).toEqual(['precarico']);
    // Senza Filo il clic aspetterebbe i due secondi del server e poco più: col precarico partito prima, meno.
    expect(attesa).toBeLessThan(RITARDO + 600);
  } finally { await new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }); }
});
