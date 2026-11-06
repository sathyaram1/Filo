// #1985 giro 3: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function sito({ lente = [], ritardo = 2000 } = {}) {
  const richieste = [];
  const server = createServer((req, res) => {
    const r = { url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || ''), t: Date.now(), chiusaPrima: false };
    richieste.push(r);
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    const html = (body) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>${req.url}</title><body style="margin:0">${body}</body>`);
    };
    if (req.url.startsWith('/indice')) {
      html(Array.from({ length: 30 }, (_, i) => `<a id="l${i}" style="display:block;height:18px" href="/p/${i}">link ${i}</a>`).join(''));
      return;
    }
    res.on('close', () => { if (!res.writableEnded) r.chiusaPrima = true; });
    setTimeout(() => { if (!res.destroyed) html(`<h1 id="arrivato">${req.url}</h1>`); }, lente.includes(req.url) ? ritardo : 0);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    richieste,
    precarichi: () => richieste.filter((r) => r.prefetch).map((r) => r.url),
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

test('touch: il tocco su un link lo precarica', async ({ app, openTab }) => {
  const s = await sito();
  try {
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ precarico: { visibili: false } }); });
    const page = await openTab(`${s.origin}/indice`);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
    const b = await page.locator('#l5').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + 5, y: b.y + 5 }] });
    await page.waitForTimeout(1500);
    const dopo = s.precarichi();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    console.log('TOUCH precarichi', JSON.stringify(dopo));
    expect(dopo).toEqual(['/p/5']);
  } finally { await s.chiudi(); }
});

test('link a schermo lento cliccato mentre il precarico è in corso', async ({ openTab }) => {
  const RITARDO = 2000;
  const s = await sito({ lente: ['/p/0'], ritardo: RITARDO });
  try {
    const page = await openTab(`${s.origin}/indice`);
    await expect.poll(() => s.precarichi().includes('/p/0'), { timeout: 30_000, intervals: [100] }).toBe(true);
    await page.waitForTimeout(200);
    const t0 = Date.now();
    await page.click('#l0', { noWaitAfter: true });
    await expect(page.locator('#arrivato')).toHaveText('/p/0', { timeout: 15_000 });
    const attesa = Date.now() - t0;
    const r0 = s.richieste.filter((r) => r.url === '/p/0').map((r) => r.prefetch);
    console.log('LENTO attesa', attesa, 'richieste /p/0', JSON.stringify(r0));
    expect(r0).toEqual([true]);
    expect(attesa).toBeLessThan(RITARDO);
  } finally { await s.chiudi(); }
});

test('clic su un altro link ferma i link a schermo in corso', async ({ openTab }) => {
  const s = await sito({ lente: ['/p/0', '/p/1', '/p/2'], ritardo: 15_000 });
  try {
    const page = await openTab(`${s.origin}/indice`);
    await expect.poll(() => s.precarichi().length, { timeout: 30_000, intervals: [100] }).toBeGreaterThanOrEqual(2);
    await page.click('#l29');
    await expect(page.locator('#arrivato')).toHaveText('/p/29');
    await page.waitForTimeout(3000);
    const aperti = s.richieste.filter((r) => r.prefetch && ['/p/0', '/p/1', '/p/2'].includes(r.url)).map((r) => [r.url, r.chiusaPrima]);
    console.log('FERMA', JSON.stringify(aperti));
    expect(aperti.every(([, c]) => c)).toBe(true);
  } finally { await s.chiudi(); }
});
