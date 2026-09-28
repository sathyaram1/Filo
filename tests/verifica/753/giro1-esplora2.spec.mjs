// Verifica #753 giro 1 (esplorazione): Manuale, Privacy, riquadri srcdoc/about:blank/worker, finestra nascosta dei link sospetti.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function serverGpc() {
  const richieste = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    richieste.push({ host: req.headers.host, path: u.pathname + u.search, gpc: req.headers['sec-gpc'] ?? null });
    const tag = u.searchParams.get('t') || '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (u.pathname === '/p') {
      res.end(`<!doctype html><html><head><script>document.documentElement.dataset.gpc=String(navigator.globalPrivacyControl);</script><title>P${tag}</title></head><body>
        <iframe id="sd" srcdoc="<script>document.documentElement.dataset.gpc=String(navigator.globalPrivacyControl)</script>"></iframe>
        <script>
          var f=document.createElement('iframe');document.body.appendChild(f);
          window.__blank=String(f.contentWindow.navigator.globalPrivacyControl);
          try{var w=new Worker(URL.createObjectURL(new Blob(['postMessage(String(navigator.globalPrivacyControl))'])));w.onmessage=function(e){window.__worker=e.data};}catch(e){window.__worker='err'}
        </script></body></html>`);
    } else if (u.pathname === '/d') {
      res.end(`<!doctype html><html><head><title>D${tag}</title><script src="https://www.google-analytics.com/analytics.js?d=${tag}"></script></head><body>d</body></html>`);
    } else { res.end('ok'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, richieste, close: () => { server.closeAllConnections?.(); return new Promise((r) => server.close(r)); } };
}

async function setMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="cookie-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

async function paginaPer(app, url, timeout = 20_000) {
  const fine = Date.now() + timeout;
  while (Date.now() < fine) {
    const cand = app.windows().filter((w) => { try { return !w.isClosed() && w.url() === url; } catch (_) { return false; } });
    for (const p of cand.reverse()) {
      try { await p.waitForFunction(() => document.documentElement.dataset.gpc && window.__worker, null, { timeout: 3000 }); return p; } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('nessuna pagina viva per ' + url);
}

async function leggi(page) {
  return page.evaluate(() => ({
    head: document.documentElement.dataset.gpc,
    srcdoc: document.getElementById('sd').contentDocument.documentElement.dataset.gpc,
    blank: window.__blank,
    worker: window.__worker,
  }));
}

test('manuale su schede normali e incognito già aperte, poi privacy', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  const srv = await serverGpc();
  const esiti = {};
  try {
    const u1 = `http://127.0.0.1:${srv.port}/p?t=A`;
    await openTab(u1);
    esiti.normaleDefault = await leggi(await paginaPer(app, u1));
    await shell.evaluate(() => window.filoShell.openIncognito());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoTabs && w._filoTabs.incognito))).toBe(true);
    const apriIncognito = (u) => app.evaluate(({ BrowserWindow }, x) => {
      BrowserWindow.getAllWindows().find((w) => w._filoTabs && w._filoTabs.incognito)._filoTabs.openTab(x);
    }, u);
    const uI0 = `http://127.0.0.1:${srv.port}/p?t=I0`;
    await apriIncognito(uI0);
    await paginaPer(app, uI0);

    await setMode(openTab, 'manual');
    const u2 = `http://127.0.0.1:${srv.port}/p?t=M`;
    await openTab(u2);
    esiti.normaleManuale = await leggi(await paginaPer(app, u2));
    const uI = `http://127.0.0.1:${srv.port}/p?t=IM`;
    await apriIncognito(uI);
    esiti.incognitoManuale = await leggi(await paginaPer(app, uI));

    await setMode(openTab, 'privacy');
    const u3 = `http://127.0.0.1:${srv.port}/p?t=PR`;
    await openTab(u3);
    esiti.privacy = await leggi(await paginaPer(app, u3));
    esiti.header = srv.richieste.filter((r) => r.path.startsWith('/p')).map((r) => `${r.path} ${r.gpc}`);
    console.log('ESITI2', JSON.stringify(esiti));
  } finally { await srv.close(); }
  expect(esiti.normaleDefault).toEqual({ head: 'true', srcdoc: 'true', blank: 'true', worker: 'true' });
  expect(esiti.normaleManuale).toEqual({ head: 'undefined', srcdoc: 'undefined', blank: 'undefined', worker: 'undefined' });
  expect(esiti.incognitoManuale).toEqual({ head: 'undefined', srcdoc: 'undefined', blank: 'undefined', worker: 'undefined' });
  expect(esiti.privacy).toEqual({ head: 'true', srcdoc: 'true', blank: 'true', worker: 'true' });
});

test('link sospetto aperto in incognito: la finestra nascosta non carica i tracker', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const srv = await serverGpc();
  try {
    await app.evaluate(({ app: a, session }) => {
      globalThis.__ga = [];
      const aggancia = (ses) => {
        const chi = () => (ses === session.defaultSession ? 'default' : (globalThis.__filoSessioni && globalThis.__filoSessioni.eNata(ses) ? 'protetta' : 'esente'));
        ses.webRequest.onErrorOccurred({ urls: ['*://*.google-analytics.com/*'] }, (d) => globalThis.__ga.push(`${chi()} ${d.error}`));
        ses.webRequest.onCompleted({ urls: ['*://*.google-analytics.com/*'] }, (d) => globalThis.__ga.push(`${chi()} caricato ${d.statusCode}`));
      };
      aggancia(session.defaultSession);
      a.on('session-created', aggancia);
    });
    await shell.evaluate(() => window.filoShell.openIncognito());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoTabs && w._filoTabs.incognito))).toBe(true);
    const u = `http://127.0.0.1:${srv.port}/d?t=X`;
    await app.evaluate(({ BrowserWindow }, x) => {
      BrowserWindow.getAllWindows().find((w) => w._filoTabs && w._filoTabs.incognito)._filoTabs.openTab(x);
    }, u);
    await new Promise((r) => setTimeout(r, 8000));
    const ga = await app.evaluate(() => globalThis.__ga);
    const dLoads = srv.richieste.filter((r) => r.path.startsWith('/d')).map((r) => `${r.path} ${r.gpc}`);
    console.log('ESITI3', JSON.stringify({ ga, dLoads }));
    expect(dLoads.length).toBeGreaterThan(1);
    expect(ga.filter((x) => !x.endsWith('net::ERR_BLOCKED_BY_CLIENT'))).toEqual([]);
  } finally { await srv.close(); }
});
