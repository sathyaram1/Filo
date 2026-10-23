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
});
