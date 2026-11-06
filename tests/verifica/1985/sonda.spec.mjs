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

const CASI = {
  listModerate: (u) => [{ prefetch: [{ source: 'list', urls: [u], eagerness: 'moderate' }] }],
  listConservative: (u) => [{ prefetch: [{ source: 'list', urls: [u], eagerness: 'conservative' }] }],
  listEager: (u) => [{ prefetch: [{ source: 'list', urls: [u], eagerness: 'eager' }] }],
  immediatePoiModerate: (u) => [{ prefetch: [{ source: 'list', urls: [u] }] }, { prefetch: [{ source: 'list', urls: [u], eagerness: 'moderate' }] }],
  docModerate: () => [{ prefetch: [{ source: 'document', eagerness: 'moderate' }] }],
};

test('sonda', async ({ app, openTab }) => {
  test.setTimeout(240_000);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ blocklist: ['127.0.0.1'] }); });
  for (const [nome, regole] of Object.entries(CASI)) {
    const s = await sito(1500);
    try {
      const page = await openTab(`${s.origin}/pag`);
      await page.waitForLoadState('load');
      await page.waitForTimeout(500);
      const u = `${s.origin}/pag/3`;
      if (nome === 'immediatePoiModerate') {
        const [a, b] = regole(u);
        await page.evaluate((r) => { const x = document.createElement('script'); x.type = 'speculationrules'; x.textContent = JSON.stringify(r); document.head.append(x); }, a);
        await page.waitForTimeout(100);
        await page.hover('#l3');
        await page.waitForTimeout(65);
        await page.evaluate((r) => { const x = document.createElement('script'); x.type = 'speculationrules'; x.textContent = JSON.stringify(r); document.head.append(x); }, b);
      } else {
        if (nome === 'docModerate') await page.evaluate((r) => { const x = document.createElement('script'); x.type = 'speculationrules'; x.textContent = JSON.stringify(r); document.head.append(x); }, regole(u)[0]);
        await page.hover('#l3');
        await page.waitForTimeout(65);
        if (nome !== 'docModerate') await page.evaluate((r) => { const x = document.createElement('script'); x.type = 'speculationrules'; x.textContent = JSON.stringify(r); document.head.append(x); }, regole(u)[0]);
      }
      await page.waitForTimeout(235);
      const primaDelClic = s.richieste.filter((x) => x.url === '/pag/3').length;
      const t0 = Date.now();
      await page.click('#l3', { noWaitAfter: true });
      await expect(page.locator('#arrivato')).toHaveText('/pag/3', { timeout: 15_000 });
      console.log('SONDA', nome, Date.now() - t0, 'primaDelClic', primaDelClic, s.richieste.filter((x) => x.url === '/pag/3').map((x) => (x.prefetch ? 'P' : 'N')).join(''));
    } finally { await s.chiudi(); }
  }
});
