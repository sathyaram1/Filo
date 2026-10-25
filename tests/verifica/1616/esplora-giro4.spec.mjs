// Esplorazione del giro 4 di #1616: hint chiesti con Accept-CH e finestrella di accesso aperta da un sito.

import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const HOST = ['login.live.com', 'filo.auth0.com', 'filo.b2clogin.com'];

async function server(gestisci) {
  const viste = [];
  const s = createServer((req, res) => {
    viste.push({ host: String(req.headers.host || '').split(':')[0], url: req.url, h: { ...req.headers } });
    gestisci(req, res, s.address().port);
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { viste, port: s.address().port, async chiudi() { try { s.closeAllConnections?.(); } catch (_) {} await new Promise((r) => s.close(r)); } };
}

test('accept-ch: gli hint chiesti dal sito arrivano alla richiesta dopo', async ({ openTab }) => {
  const srv = await server((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Accept-CH': 'Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Model, Sec-CH-UA-Full-Version' });
    res.end('<title>CH</title><p>ok</p>');
  });
  try {
    const p = await openTab(`http://127.0.0.1:${srv.port}/uno`);
    await p.waitForLoadState('load').catch(() => {});
    await p.evaluate(() => fetch('/due').then((r) => r.text()));
    await p.evaluate(() => { location.href = '/tre'; });
    await expect.poll(() => srv.viste.some((v) => v.url === '/tre'), { timeout: 8000 }).toBe(true);
    const js = await p.evaluate(async () => {
      const d = navigator.userAgentData;
      return d ? { brands: d.brands, alti: await d.getHighEntropyValues(['fullVersionList', 'platformVersion', 'architecture', 'bitness', 'model', 'uaFullVersion']) } : null;
    }).catch((e) => String(e));
    console.log('JS', JSON.stringify(js));
    for (const v of srv.viste) console.log(v.url, JSON.stringify(Object.fromEntries(Object.entries(v.h).filter(([k]) => k.startsWith('sec-ch')))));
  } finally { await srv.chiudi(); }
});

test.describe('finestrella', () => {
  test.use({ hostInPiu: HOST });
  test('una finestrella di accesso aperta da un sito vede Chrome e non riceve il GPC', async ({ app, openTab }) => {
    await app.evaluate(() => globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null }));
    let host = null;
    const srv = await server((req, res, port) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.url.startsWith('/sito')) {
        res.end(`<title>Sito</title><button id="b" onclick="window.open('http://${'HOSTX'}:${port}/oauth/authorize?client_id=x','accedi','width=500,height=600')">Continua</button>`);
      } else res.end('<title>Accedi</title><p>login</p>');
    });
    try {
      const sito = await openTab(`http://127.0.0.1:${srv.port}/sito`);
      for (const h of HOST) {
        await sito.evaluate((h) => { const b = document.getElementById('b'); b.setAttribute('onclick', b.getAttribute('onclick').replace(/HOSTX|login\.live\.com|filo\.auth0\.com|filo\.b2clogin\.com/, h)); }, h);
        await sito.click('#b');
        if (await expect.poll(() => srv.viste.some((v) => v.host === h), { timeout: 3000 }).toBe(true).then(() => true, () => false)) { host = h; break; }
      }
      expect(host).not.toBeNull();
      const v = srv.viste.find((x) => x.host === host).h;
      console.log('POPUP HEADERS', JSON.stringify(v));
      const f = await aspettaFinestra(app, (w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } }, 'finestrella');
      await f.waitForLoadState('load').catch(() => {});
      await f.waitForTimeout(500);
      const r = await f.evaluate(async () => {
        const ctrl = new AbortController();
        const q = navigator.credentials.get({ mediation: 'conditional', signal: ctrl.signal, publicKey: { challenge: new Uint8Array(32), rpId: location.hostname, allowCredentials: [] } });
        const e = await Promise.race([q.then(() => 'ok', (x) => 'no:' + x.name), new Promise((res) => setTimeout(() => res('attesa'), 1000))]);
        ctrl.abort();
        return { gpc: navigator.globalPrivacyControl, chrome: !!(window.chrome && window.chrome.runtime), cond: e };
      });
      console.log('POPUP JS', JSON.stringify(r));
      expect({ gpc: v['sec-gpc'], ch: /Chromium/.test(v['sec-ch-ua'] || ''), js: r }).toEqual({ gpc: undefined, ch: true, js: { gpc: false, chrome: true, cond: 'attesa' } });
    } finally { await srv.chiudi(); }
  });
});
