// #1985 giro 2: esplorazione del verificatore.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function sito({ lente = {}, extraHtml = '' } = {}) {
  const richieste = [];
  const server = createServer((req, res) => {
    const r = { url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || ''), t: Date.now(), chiusaPrima: false };
    richieste.push(r);
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    if (req.url === '/report') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="report.txt"' });
      res.end('ciao');
      return;
    }
    const m = /^\/(pag[a-z]*)$/.exec(req.url);
    if (m) {
      const pref = m[1];
      const links = Array.from({ length: 10 }, (_, i) => `<a id="l${i}" style="display:block;height:18px" href="/${pref}/${i}">link ${i}</a>`).join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0"><a id="scarica" href="/report">Scarica</a>${links}${extraHtml}</body>`);
      return;
    }
    res.on('close', () => { if (!res.writableEnded) r.chiusaPrima = true; });
    const ms = lente[req.url] || 0;
    setTimeout(() => {
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><h1 id="arrivato">${req.url}</h1>`);
    }, ms);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    richieste,
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

test('server lento: passaggio del mouse 300 ms prima del clic', async ({ app, openTab }) => {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ precarico: { visibili: false } }); });
  const s = await sito({ lente: { '/pag/3': 1500 } });
  try {
    const page = await openTab(`${s.origin}/pag`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    await page.hover('#l3');
    await page.waitForTimeout(300);
    const t0 = Date.now();
    await page.click('#l3', { noWaitAfter: true });
    await expect(page.locator('#arrivato')).toHaveText('/pag/3', { timeout: 10_000 });
    const dt = Date.now() - t0;
    const r = s.richieste.filter((x) => x.url === '/pag/3');
    console.log('LENTO', dt, JSON.stringify(r));
  } finally { await s.chiudi(); }
});

test('scheda aperta dietro: i link a schermo partono lo stesso?', async ({ openTab }) => {
  const s = await sito();
  try {
    await openTab(`${s.origin}/pagdietro`);
    await openTab(`${s.origin}/pagdavanti`);
    await new Promise((r) => setTimeout(r, 12_000));
    const dietro = s.richieste.filter((x) => x.prefetch && x.url.startsWith('/pagdietro/')).length;
    const davanti = s.richieste.filter((x) => x.prefetch && x.url.startsWith('/pagdavanti/')).length;
    console.log('DIETRO', dietro, 'DAVANTI', davanti);
  } finally { await s.chiudi(); }
});

test('dopo un clic che scarica, i link già precaricati servono ancora?', async ({ openTab }) => {
  const s = await sito();
  try {
    const page = await openTab(`${s.origin}/pag`);
    await expect.poll(() => s.richieste.filter((x) => x.prefetch).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
    await page.click('#scarica');
    await page.waitForTimeout(1500);
    await page.click('#l0');
    await expect(page.locator('#arrivato')).toHaveText('/pag/0');
    console.log('DOPO-SCARICO', JSON.stringify(s.richieste.filter((x) => x.url === '/pag/0')));
  } finally { await s.chiudi(); }
});
