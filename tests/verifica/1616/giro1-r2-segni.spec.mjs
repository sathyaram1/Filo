// r2: la pagina (di accesso) non deve poter riconoscere i ritocchi di Filo né ricevere il GPC dalle sue sottorisorse.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test('r2 le funzioni sostituite da Filo sono indistinguibili da quelle native, anche viste da un riquadro vuoto', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>SEGNI</title><p>ok</p>');
  const r = await page.evaluate(() => {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    const altro = f.contentWindow.Function.prototype.toString;
    const out = {
      getPrototype: Object.prototype.hasOwnProperty.call(navigator.credentials.get, 'prototype'),
      connectPrototype: Object.prototype.hasOwnProperty.call(window.chrome.runtime.connect, 'prototype'),
      csiPrototype: Object.prototype.hasOwnProperty.call(window.chrome.csi, 'prototype'),
      getDaRiquadro: altro.call(navigator.credentials.get),
      connectDaRiquadro: altro.call(window.chrome.runtime.connect),
    };
    f.remove();
    return out;
  });
  expect(r).toEqual({
    getPrototype: false, connectPrototype: false, csiPrototype: false,
    getDaRiquadro: 'function get() { [native code] }',
    connectDaRiquadro: 'function connect() { [native code] }',
  });
});

test.describe('pagina di accesso', () => {
  test.use({ hostInPiu: ['login.live.com', 'filo.auth0.com', 'filo.b2clogin.com'] });

  test('r2 gli script e le immagini caricati dalla pagina di accesso non portano il GPC', async ({ app, shell }) => {
    await app.evaluate(() => globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null }));
    const viste = [];
    const server = createServer((req, res) => {
      viste.push({ host: String(req.headers.host || '').split(':')[0], url: req.url, h: { ...req.headers } });
      if (req.url.startsWith('/risorsa')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('void 0;'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<title>Accedi</title><h1>Accesso</h1><script src="http://127.0.0.1:${server.address().port}/risorsa.js"></script>`);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      let host = null;
      for (const h of ['login.live.com', 'filo.auth0.com', 'filo.b2clogin.com']) {
        await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${h}:${server.address().port}/login`);
        if (await expect.poll(() => viste.some((v) => v.host === h), { timeout: 3_000 }).toBe(true).then(() => true, () => false)) { host = h; break; }
      }
      expect(host, 'nessun host di accesso si apre in http').not.toBeNull();
      await expect.poll(() => viste.some((v) => v.url.startsWith('/risorsa')), { timeout: 8_000 }).toBe(true);
      expect(viste.find((v) => v.host === host).h['sec-gpc']).toBeUndefined();
      expect(viste.find((v) => v.url.startsWith('/risorsa')).h['sec-gpc'], 'lo script della pagina di accesso porta Sec-GPC').toBeUndefined();
    } finally { server.close(); }
  });
});
