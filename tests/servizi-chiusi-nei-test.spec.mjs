// Nelle prove il servizio vero delle schede non si raggiunge da nessuna porta (#735.1): la bacheca
// aperta senza rete finta non mostra schede vere e non le lascia su disco, in GitHub come nei contenitori.
// L'errore atteso è il blocco di Filo, non un guasto di rete: senza la chiusura qui o si passa o si sbaglia diverso.

import { test, expect } from './fixtures/electron.mjs';
import { launchFilo, closeFilo } from './agent/driver.mjs';

const SCHEDE = 'https://firestore.googleapis.com/v1/projects/filo-prova/databases/(default)/documents:runQuery';

test('la bacheca aperta senza rete finta non vede le schede vere, e non le lascia su disco', async ({ app, openTab }) => {
  await app.evaluate(({ session }, url) => {
    globalThis.__erroriSchede = [];
    session.defaultSession.webRequest.onErrorOccurred({ urls: [url.replace(/\/v1\/.*$/, '/*')] }, (d) => {
      globalThis.__erroriSchede.push(d.error);
    });
  }, SCHEDE);

  const page = await openTab('filo://board/board.html');
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });

  await expect(page.locator('#bdError')).toBeVisible();
  await expect(page.locator('.bd-card')).toHaveCount(0);
  const copia = await page.evaluate(() => new Promise((r) => chrome.storage.local.get('sn_board_schede', (o) => r(o && o.sn_board_schede))));
  expect(copia ?? null).toBeNull();

  const errori = await app.evaluate(() => globalThis.__erroriSchede);
  expect(errori.length).toBeGreaterThan(0);
  expect([...new Set(errori)]).toEqual(['net::ERR_BLOCKED_BY_CLIENT']);
});

test('una sessione nata dopo l\'avvio (incognito, privacy) è chiusa anche lei', async ({ app }) => {
  const esito = await app.evaluate(async ({ session }, url) => {
    const ses = session.fromPartition(`prova-servizi-${Date.now()}`);
    try { const r = await ses.fetch(url, { method: 'POST', body: '{}' }); return `raggiunto: ${r.status}`; } catch (e) { return String(e && e.message); }
  }, SCHEDE);
  expect(esito).toContain('ERR_BLOCKED_BY_CLIENT');
});

// Si parte ad avvio finito: un app.evaluate che cade mentre il main carica undici trova il fetch
// di Node a metà («fetchImpl is not a function»), con o senza chiusura.
test('il fetch del main non parte verso le schede e fallisce come senza rete', async ({ app, shell, testServer }) => {
  await shell.waitForFunction(() => document.readyState === 'complete');
  await expect.poll(() => app.evaluate(() => typeof globalThis.SN_FEEDBACK)).toBe('object');
  const esito = await app.evaluate(async (_e, url) => {
    try { const r = await fetch(url, { method: 'POST', body: '{}' }); return { raggiunto: r.status }; } catch (e) { return { messaggio: e.message, causa: e.cause ? String(e.cause.code || e.cause.message) : null }; }
  }, SCHEDE);
  // Un guasto vero di rete porta la sua causa (ENOTFOUND, ECONNREFUSED…); la chiusura no.
  expect(esito).toEqual({ messaggio: 'fetch failed', causa: null });

  // Il resto della rete del main resta com'è: la chiusura non è un «offline» generale.
  const locale = await app.evaluate(async (_e, u) => (await fetch(u)).text(), testServer.html('ok'));
  expect(locale).toBe('ok');
});

// Il pilota degli agenti apre Filo fuori dalla modalità test (cattura composita, test:shoot): chiuso anche lì.
test('Filo aperto dal pilota degli agenti non raggiunge le schede', async () => {
  const { app, shell } = await launchFilo();
  try {
    await shell.waitForFunction(() => document.readyState === 'complete');
    const esito = await app.evaluate(async ({ session }, url) => {
      try { const r = await session.defaultSession.fetch(url, { method: 'POST', body: '{}' }); return `raggiunto: ${r.status}`; } catch (e) { return String(e && e.message); }
    }, SCHEDE);
    expect(esito).toContain('ERR_BLOCKED_BY_CLIENT');
  } finally {
    await closeFilo(app);
  }
});
