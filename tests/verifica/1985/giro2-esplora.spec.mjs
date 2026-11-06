// #1985 giro 2: esplorazione del verificatore.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function sito({ ritardo = 0 } = {}) {
  const richieste = [];
  const server = createServer((req, res) => {
    const r = { url: req.url, prefetch: /prefetch/.test(req.headers['sec-purpose'] || ''), t: Date.now() };
    richieste.push(r);
    if (req.url === '/favicon.ico') { res.writeHead(404); res.end(); return; }
    const m = /^\/(pag[a-z]*)$/.exec(req.url);
    if (m) {
      const pref = m[1];
      const links = Array.from({ length: 10 }, (_, i) => `<a id="l${i}" style="display:block;height:18px" href="/${pref}/${i}">link ${i}</a>`).join('');
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
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    richieste,
    chiudi: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

async function misura(page, s, { hover, regola }) {
  if (regola) {
    await page.evaluate((r) => { const x = document.createElement('script'); x.type = 'speculationrules'; x.textContent = JSON.stringify(r); document.head.append(x); }, regola);
  }
  if (hover) { await page.hover('#l3'); await page.waitForTimeout(300); }
  const t0 = Date.now();
  await page.click('#l3', { noWaitAfter: true });
  await expect(page.locator('#arrivato')).toHaveText('/pag/3', { timeout: 15_000 });
  return { ms: Date.now() - t0, richieste: s.richieste.filter((x) => x.url === '/pag/3').map((x) => (x.prefetch ? 'P' : 'N')).join('') };
}

for (const ritardo of [600, 1500, 3000]) {
  test(`server a ${ritardo} ms: senza Filo, con Filo, con regola moderate`, async ({ app, openTab }) => {
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ precarico: { visibili: false } }); });
    const esiti = {};
    for (const caso of ['filo', 'base', 'moderate', 'immediate']) {
      const s = await sito({ ritardo });
      try {
        const spento = caso !== 'filo';
        await app.evaluate(async (_e, b) => { await globalThis.SN_STORAGE.updateSettings({ blocklist: b ? ['127.0.0.1'] : [] }); }, spento);
        const page = await openTab(`${s.origin}/pag`);
        await page.waitForLoadState('load');
        await page.waitForTimeout(800);
        const regola = caso === 'moderate' ? { prefetch: [{ source: 'document', eagerness: 'moderate' }] }
          : caso === 'immediate' ? null : null;
        if (caso === 'immediate') {
          await page.hover('#l3');
          await page.evaluate((u) => { const x = document.createElement('script'); x.type = 'speculationrules'; x.textContent = JSON.stringify({ prefetch: [{ source: 'list', urls: [u] }] }); document.head.append(x); }, `${s.origin}/pag/3`);
          await page.waitForTimeout(300);
          const t0 = Date.now();
          await page.click('#l3', { noWaitAfter: true });
          await expect(page.locator('#arrivato')).toHaveText('/pag/3', { timeout: 15_000 });
          esiti[caso] = { ms: Date.now() - t0, richieste: s.richieste.filter((x) => x.url === '/pag/3').map((x) => (x.prefetch ? 'P' : 'N')).join('') };
        } else {
          esiti[caso] = await misura(page, s, { hover: caso !== 'base', regola });
        }
      } finally { await s.chiudi(); }
    }
    console.log('RITARDO', ritardo, JSON.stringify(esiti));
  });
}

test('scheda aperta dietro: visibilità', async ({ app, openTab }) => {
  const s = await sito();
  try {
    const dietro = await openTab(`${s.origin}/pagdietro`);
    await dietro.waitForLoadState('load');
    await openTab(`${s.origin}/pagdavanti`);
    await dietro.waitForTimeout(1000);
    const prima = s.richieste.filter((x) => x.prefetch && x.url.startsWith('/pagdietro/')).length;
    const vis = await dietro.evaluate(() => document.visibilityState);
    await new Promise((r) => setTimeout(r, 10_000));
    const dopo = s.richieste.filter((x) => x.prefetch && x.url.startsWith('/pagdietro/')).length;
    console.log('DIETRO', vis, prima, '->', dopo);
  } finally { await s.chiudi(); }
});
