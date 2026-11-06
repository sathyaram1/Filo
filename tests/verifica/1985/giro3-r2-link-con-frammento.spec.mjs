// #1985 giro 3, r2: un link a una sezione di un'altra pagina (indirizzo con #) si precarica, e il clic usa il precarico.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function sito() {
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push({ url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || '') });
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url === '/indice') {
      res.end('<!doctype html><meta charset="utf-8"><body style="margin:0"><a id="fr" style="display:block;height:30px" href="/articolo#commenti">12 commenti</a></body>');
      return;
    }
    res.end(`<!doctype html><meta charset="utf-8"><body><h1 id="arrivato">${req.url}</h1><div style="height:2000px"></div><p id="commenti">commenti</p></body>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    richieste,
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

test('r2 il mouse fermo su un link a una sezione di un\'altra pagina la precarica, e il clic usa quel precarico', async ({ app, openTab }) => {
  const s = await sito();
  try {
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ precarico: { visibili: false } }); });
    const page = await openTab(`${s.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.hover('#fr');
    await expect.poll(() => s.richieste.filter((r) => r.url === '/articolo' && r.prefetch).length, { timeout: 5000 }).toBe(1);
    await page.click('#fr');
    await expect(page.locator('#arrivato')).toHaveText('/articolo');
    expect(s.richieste.filter((r) => r.url === '/articolo').map((r) => r.prefetch)).toEqual([true]);
  } finally { await s.chiudi(); }
});

test('r2 un link a schermo verso una sezione di un\'altra pagina, precaricato a pagina ferma, al clic non si riscarica', async ({ openTab }) => {
  const s = await sito();
  try {
    const page = await openTab(`${s.origin}/indice`);
    await expect.poll(() => s.richieste.some((r) => r.url === '/articolo' && r.prefetch), { timeout: 30_000, intervals: [250] }).toBe(true);
    await page.waitForTimeout(1000);
    await page.click('#fr');
    await expect(page.locator('#arrivato')).toHaveText('/articolo');
    expect(s.richieste.filter((r) => r.url === '/articolo').map((r) => r.prefetch)).toEqual([true]);
  } finally { await s.chiudi(); }
});
