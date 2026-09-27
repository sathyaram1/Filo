// Verifica #735.1 giro 1: le altre porte verso il servizio delle schede, oltre a bacheca, fetch del main e sessioni nuove.
// Ogni porta deve fallire col blocco di Filo, non con un guasto di rete che dipende dall'ambiente.

import { test, expect } from '../../fixtures/electron.mjs';

const SCHEDE = 'https://firestore.googleapis.com/v1/projects/filo-prova/databases/(default)/documents/feedback-public';

test('una pagina web in una scheda non raggiunge le schede', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<!doctype html><title>p</title><p>pagina</p>');
  const page = await openTab(url);
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ webContents }, u) => {
    globalThis.__erroriPagina = [];
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === u);
    wc.session.webRequest.onErrorOccurred({ urls: ['https://*.googleapis.com/*'] }, (d) => globalThis.__erroriPagina.push(d.error));
  }, url);
  const esito = await page.evaluate(async (s) => {
    try { const r = await fetch(s, { mode: 'no-cors' }); return `raggiunto ${r.type}`; } catch (e) { return 'fallito'; }
  }, SCHEDE);
  expect(esito).toBe('fallito');
  await expect.poll(() => app.evaluate(() => globalThis.__erroriPagina)).toEqual(['net::ERR_BLOCKED_BY_CLIENT']);
});

test('net.fetch e net.request del main non raggiungono le schede', async ({ app, shell }) => {
  await shell.waitForFunction(() => document.readyState === 'complete');
  const esiti = await app.evaluate(async ({ net }, s) => {
    const out = {};
    try { const r = await net.fetch(s); out.netFetch = `raggiunto ${r.status}`; } catch (e) { out.netFetch = String(e && e.message); }
    out.netRequest = await new Promise((resolve) => {
      const req = net.request(s);
      req.on('response', (r) => resolve(`raggiunto ${r.statusCode}`));
      req.on('error', (e) => resolve(String(e && e.message)));
      req.end();
    });
    return out;
  }, SCHEDE);
  expect(esiti.netFetch).toContain('ERR_BLOCKED_BY_CLIENT');
  expect(esiti.netRequest).toContain('ERR_BLOCKED_BY_CLIENT');
});

test('grafie diverse dello stesso indirizzo sono chiuse anche loro', async ({ app, shell }) => {
  await shell.waitForFunction(() => document.readyState === 'complete');
  await expect.poll(() => app.evaluate(() => typeof globalThis.SN_FEEDBACK)).toBe('object');
  const esiti = await app.evaluate(async (_e, urls) => {
    const out = [];
    for (const u of urls) {
      try { const r = await fetch(u); out.push(`raggiunto ${r.status}`); } catch (e) { out.push(e.cause ? `rete ${e.cause.code || e.cause.message}` : e.message); }
    }
    return out;
  }, [
    'https://FIRESTORE.googleapis.com/v1/x',
    'https://firestore.googleapis.com.:443/v1/x',
    new URL('https://firestore.googleapis.com/v1/x'),
  ].map(String));
  expect(esiti).toEqual(['fetch failed', 'fetch failed', 'fetch failed']);

  // Anche come oggetto Request, non solo come stringa.
  const req = await app.evaluate(async (_e, u) => {
    try { const r = await fetch(new Request(u)); return `raggiunto ${r.status}`; } catch (e) { return e.cause ? `rete ${e.cause.code || e.cause.message}` : e.message; }
  }, SCHEDE);
  expect(req).toBe('fetch failed');
});
