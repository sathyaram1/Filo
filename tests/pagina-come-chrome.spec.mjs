// L'accesso con Google in un Filo appena installato (#1616) e la passkey dal telefono (#1608): la pagina vede un
// window.chrome come in Chrome e la richiesta passkey condizionale resta in sospeso; il sito riceve i client hints onesti
// («Chromium», mai «Google Chrome») insieme al GPC, tranne le pagine di accesso dei provider noti, che il GPC non lo vedono.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

// Un sito che annota le intestazioni della prima richiesta di pagina.
async function sitoCheAnnota() {
  let viste = null;
  const server = createServer((req, res) => {
    if (!viste) viste = { ...req.headers };
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>HINTS</title><p>ok</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/pagina`,
    viste: () => viste,
    async chiudi() { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

// Le pagine https le serve Filo stesso (niente rete); le intestazioni partite davvero le annota onSendHeaders, che vede
// il risultato dell'unico onBeforeSendHeaders.
async function serviHttps(app, pagine) {
  await app.evaluate(({ session, net }, pg) => {
    globalThis.__intestazioniPartite = {};
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    try { session.defaultSession.protocol.unhandle('https'); } catch (_) {}
    session.defaultSession.protocol.handle('https', risposta);
    session.defaultSession.webRequest.onSendHeaders({ urls: ['https://*/*'] }, (d) => {
      if (d.resourceType === 'mainFrame') globalThis.__intestazioniPartite[new URL(d.url).hostname] = { ...d.requestHeaders };
    });
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: null, rdap: null, ct: null, sandbox: null, llm: null });
  }, pagine);
}
const partite = (app) => app.evaluate(() => globalThis.__intestazioniPartite || {});
const minuscole = (h) => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]));

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

test('il sito riceve i client hints onesti, con la versione vera di Chromium, e il GPC', async ({ openTab }) => {
  const sito = await sitoCheAnnota();
  try {
    await openTab(sito.url);
    await expect.poll(() => sito.viste() && sito.viste()['sec-ch-ua'], { timeout: 6_000 }).toMatch(/"Chromium";v="\d+"/);
    const h = sito.viste();
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

test('la pagina di accesso di un provider noto non riceve il GPC, né header né proprietà; un sito qualunque sì', async ({ app, openTab }) => {
  const HTML = '<title>Accedi</title><h1>Accesso</h1>';
  await serviHttps(app, { 'accounts.google.com/signin/v2/identifier': HTML, 'sito-qualunque.test/pagina': HTML });
  const normale = await openTab('https://sito-qualunque.test/pagina');
  const accesso = await openTab('https://accounts.google.com/signin/v2/identifier');
  await expect.poll(async () => Object.keys(await partite(app)).length, { timeout: 8_000 }).toBe(2);
  const viste = await partite(app);
  const qualunque = minuscole(viste['sito-qualunque.test']);
  const google = minuscole(viste['accounts.google.com']);
  expect(qualunque['sec-gpc']).toBe('1');
  expect(google['sec-gpc']).toBeUndefined();
  expect(google['sec-ch-ua']).toMatch(/"Chromium";v="\d+"/);
  expect(google['sec-ch-ua']).not.toContain('Google Chrome');
  await expect.poll(() => normale.evaluate(() => navigator.globalPrivacyControl === true), { timeout: 6_000 }).toBe(true);
  await accesso.waitForLoadState('load');
  await accesso.waitForTimeout(400);
  expect(await accesso.evaluate(() => ({ gpc: navigator.globalPrivacyControl === true, chrome: !!(window.chrome && window.chrome.runtime) })))
    .toEqual({ gpc: false, chrome: true });
});
