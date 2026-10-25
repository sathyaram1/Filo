// L'accesso con Google in un Filo appena installato (#1616) e la passkey dal telefono (#1608): la pagina vede un
// window.chrome come in Chrome e la richiesta passkey condizionale resta in sospeso; il sito riceve i client hints onesti
// («Chromium», mai «Google Chrome») insieme al GPC, tranne le pagine di accesso dei provider noti, che il GPC non lo vedono.

import { test, expect, aspettaFinestra } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

// Un sito che annota le intestazioni della prima richiesta di pagina di ogni host (le icone non contano).
async function sitoCheAnnota(html = '<title>HINTS</title><p>ok</p>') {
  const viste = new Map();
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    if (!viste.has(host) && !/favicon/.test(req.url)) viste.set(host, { ...req.headers });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    url: `http://127.0.0.1:${server.address().port}/pagina`,
    viste,
    async chiudi() { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

test('la pagina vede window.chrome pieno e la richiesta passkey condizionale resta in sospeso finché il sito non la annulla', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>CHROME</title><p>ok</p>');
  const r = await page.evaluate(async () => {
    const c = window.chrome || {};
    const ctrl = new AbortController();
    const richiesta = navigator.credentials.get({
      mediation: 'conditional', signal: ctrl.signal,
      publicKey: { challenge: new Uint8Array(32), rpId: location.hostname, allowCredentials: [], userVerification: 'preferred' },
    });
    const esito = await Promise.race([
      richiesta.then(() => 'risolta', (e) => `respinta: ${e.name}`),
      new Promise((res) => setTimeout(() => res('in sospeso'), 1500)),
    ]);
    ctrl.abort();
    const dopo = await richiesta.then(() => 'risolta', (e) => e.name);
    return {
      runtime: !!(c.runtime && typeof c.runtime.connect === 'function' && typeof c.runtime.sendMessage === 'function'),
      app: !!(c.app && typeof c.app.getIsInstalled === 'function'),
      tempi: typeof c.csi === 'function' && typeof c.loadTimes === 'function',
      nativa: c.runtime ? Function.prototype.toString.call(c.runtime.connect) : null,
      getNativa: Function.prototype.toString.call(navigator.credentials.get),
      getSulProto: !Object.prototype.hasOwnProperty.call(navigator.credentials, 'get'),
      esito, dopo,
    };
  });
  expect(r).toEqual({
    runtime: true, app: true, tempi: true,
    nativa: 'function connect() { [native code] }', getNativa: 'function get() { [native code] }', getSulProto: true,
    esito: 'in sospeso', dopo: 'AbortError',
  });
});

test('le funzioni che Filo sostituisce non si distinguono dalle native, nemmeno guardate da un riquadro vuoto creato dalla pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>SEGNI</title><p>ok</p>');
  const r = await page.evaluate(() => {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    const fw = f.contentWindow;
    const suo = fw.Function.prototype.toString;
    const proprio = (fn) => Object.prototype.hasOwnProperty.call(fn, 'prototype');
    const out = {
      prototipi: [navigator.credentials.get, window.chrome.runtime.connect, window.chrome.csi, Function.prototype.toString, suo].map(proprio),
      dalRiquadro: [suo.call(navigator.credentials.get), suo.call(window.chrome.runtime.connect), suo.call(Function.prototype.toString)],
      prototipoDellaPagina: Function.prototype.toString.call(Function.prototype),
      leSueRestano: suo.call(fw.eval('(function mia(a) { return a; })')),
    };
    f.remove();
    return out;
  });
  expect(r).toEqual({
    prototipi: [false, false, false, false, false],
    dalRiquadro: ['function get() { [native code] }', 'function connect() { [native code] }', 'function toString() { [native code] }'],
    prototipoDellaPagina: 'function () { [native code] }',
    leSueRestano: 'function mia(a) { return a; }',
  });
});

test('nella finestra incognito, sessione sempre nuova, la pagina riceve i client hints come in una scheda normale', async ({ app, shell }) => {
  const sito = await sitoCheAnnota('<title>INCOGNITO</title><p>ok</p>');
  try {
    await shell.evaluate(() => window.filoShell.openIncognito());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
      return w && w._filoTabs ? w._filoTabs.tabs.length : 0;
    }), { timeout: 15_000 }).toBe(1);
    await app.evaluate(({ BrowserWindow }, u) => {
      BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u);
    }, sito.url);
    await expect.poll(() => sito.viste.get('127.0.0.1')?.['sec-ch-ua'], { timeout: 10_000 }).toMatch(/"Chromium";v="\d+"/);
    const h = sito.viste.get('127.0.0.1');
    expect(h['sec-ch-ua-mobile']).toBe('?0');
    expect(h['sec-ch-ua-platform']).toMatch(/^"(Windows|macOS|Linux)"$/);
  } finally { await sito.chiudi(); }
});

test('il sito riceve i client hints onesti, con la versione vera di Chromium, e il GPC', async ({ openTab }) => {
  const sito = await sitoCheAnnota();
  try {
    await openTab(sito.url);
    await expect.poll(() => sito.viste.get('127.0.0.1')?.['sec-ch-ua'], { timeout: 6_000 }).toMatch(/"Chromium";v="\d+"/);
    const h = sito.viste.get('127.0.0.1');
    const maggiore = /Chrome\/(\d+)\./.exec(h['user-agent'] || '')?.[1];
    expect(maggiore).toBeTruthy();
    expect(h['sec-ch-ua']).toContain(`"Chromium";v="${maggiore}"`);
    expect(h['sec-ch-ua']).not.toContain('Google Chrome');
    expect(h['sec-ch-ua-mobile']).toBe('?0');
    expect(h['sec-ch-ua-platform']).toMatch(/^"(Windows|macOS|Linux)"$/);
    expect(h['sec-gpc']).toBe('1');
    expect(h['user-agent']).not.toMatch(/Electron|filo\//i);
  } finally { await sito.chiudi(); }
});

// Host di accesso noti (src/shared/authPopup.js) che Electron apre ancora in http: la lista HSTS di Chromium cresce e un
// host che ci entra si apre solo in https (tests/fingerprint.spec.mjs), quindi la prova usa il primo che risponde.
const HOST_DI_ACCESSO = ['login.live.com', 'filo.auth0.com', 'filo.b2clogin.com'];

test.describe('pagina di accesso di un provider noto', () => {
  test.use({ hostInPiu: HOST_DI_ACCESSO });

  test('non riceve il GPC, né come header né come proprietà, mentre un sito qualunque sì', async ({ app, shell, openTab }) => {
    await app.evaluate(() => globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null }));
    const sito = await sitoCheAnnota('<title>Accedi</title><h1>Accesso</h1>');
    try {
      const normale = await openTab(sito.url);
      let host = null;
      for (const h of HOST_DI_ACCESSO) {
        await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${h}:${sito.port}/login`);
        if (await expect.poll(() => sito.viste.has(h), { timeout: 3_000 }).toBe(true).then(() => true, () => false)) { host = h; break; }
      }
      expect(host, `nessun host di accesso si apre più in http: ${HOST_DI_ACCESSO.join(', ')}`).not.toBeNull();
      await expect.poll(() => sito.viste.get('127.0.0.1')?.['sec-gpc'], { timeout: 6_000 }).toBe('1');
      const accessoH = sito.viste.get(host);
      expect(accessoH['sec-gpc']).toBeUndefined();
      expect(accessoH['sec-ch-ua']).toMatch(/"Chromium";v="\d+"/);
      expect(accessoH['sec-ch-ua']).not.toContain('Google Chrome');
      await expect.poll(() => normale.evaluate(() => navigator.globalPrivacyControl === true), { timeout: 6_000 }).toBe(true);
      const accesso = await aspettaFinestra(app, (w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } }, `la scheda su ${host} non si trova`);
      await accesso.waitForLoadState('load').catch(() => {});
      await accesso.waitForTimeout(400);
      expect(await accesso.evaluate(() => ({ gpc: navigator.globalPrivacyControl === true, chrome: !!(window.chrome && window.chrome.runtime) })))
        .toEqual({ gpc: false, chrome: true });
    } finally { await sito.chiudi(); }
  });

  // Come Google, che dalla pagina di accesso carica il suo programma da gstatic e le risorse da www.google.com.
  test('nemmeno gli script e le immagini che la pagina di accesso carica da altri host portano il GPC; il ritorno al sito sì', async ({ app, shell }) => {
    await app.evaluate(() => globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null }));
    const viste = [];
    const server = createServer((req, res) => {
      viste.push({ host: String(req.headers.host || '').split(':')[0], url: req.url, h: { ...req.headers } });
      const port = server.address().port;
      if (req.url.startsWith('/programma')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(`location.href = 'http://127.0.0.1:${port}/ritorno';`); return; }
      if (req.url.startsWith('/logo')) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(req.url.startsWith('/login')
        ? `<title>Accedi</title><img src="http://127.0.0.1:${port}/logo.svg"><script src="http://127.0.0.1:${port}/programma.js"></script>`
        : '<title>Tornato</title><p>ok</p>');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      let host = null;
      for (const h of HOST_DI_ACCESSO) {
        await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${h}:${server.address().port}/login`);
        if (await expect.poll(() => viste.some((v) => v.host === h), { timeout: 3_000 }).toBe(true).then(() => true, () => false)) { host = h; break; }
      }
      expect(host, `nessun host di accesso si apre più in http: ${HOST_DI_ACCESSO.join(', ')}`).not.toBeNull();
      await expect.poll(() => viste.some((v) => v.url.startsWith('/ritorno')), { timeout: 10_000 }).toBe(true);
      const di = (inizio) => viste.find((v) => v.url.startsWith(inizio)).h;
      expect(di('/login')['sec-gpc']).toBeUndefined();
      expect(di('/programma')['sec-gpc'], 'lo script della pagina di accesso porta il GPC').toBeUndefined();
      expect(di('/logo')['sec-gpc'], 'l\'immagine della pagina di accesso porta il GPC').toBeUndefined();
      expect(di('/ritorno')['sec-gpc'], 'tornando al sito dalla pagina di accesso il GPC non parte').toBe('1');
    } finally { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); }
  });
});
