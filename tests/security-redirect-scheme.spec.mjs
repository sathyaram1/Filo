// SICUREZZA (#309) — gate schemi non-web sui REDIRECT lato server.
//
// Il gate isWebUnsafeNav (#247) copre will-navigate e setWindowOpenHandler, ma
// will-navigate NON scatta sui redirect 301/302: senza un handler will-redirect
// una pagina può rimbalzare la scheda verso uno schema non-web affidandosi solo
// al blocco implicito di Chromium. Questi test asseriscono il SUCCESSO del gate
// esplicito:
//   a) redirect 302 → file://  ⇒ bloccato (nessuna window file://, pagina ferma,
//      shell.openExternal MAI chiamata con file:).
//   b) redirect 302 → mailto:  ⇒ consegnato all'OS via shell.openExternal (parità
//      col cammino will-navigate del test #1b in security-hardening.spec.mjs).
//      Senza il fix questo assert è ROSSO: Chromium fallisce il redirect e
//      nessuno consegna il mailto all'OS.
//   c) redirect 302 → http(s) legittimo ⇒ passa e la pagina di destinazione
//      viene caricata davvero.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

// Mini server con endpoint di redirect: il testServer del fixture serve solo
// pagine 200, qui servono risposte 302 con Location arbitraria.
async function startRedirectServer() {
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/land') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>land</title><body data-landed="1"><p>arrivato</p>');
      return;
    }
    if (path === '/start') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>start</title><body><p>partenza</p>');
      return;
    }
    if (path === '/to-file') {
      res.writeHead(302, { Location: 'file://attacker.example/share/x' });
      res.end();
      return;
    }
    if (path === '/to-mailto') {
      res.writeHead(302, { Location: 'mailto:mario@esempio.it?subject=redirect' });
      res.end();
      return;
    }
    if (path === '/to-ok') {
      res.writeHead(302, { Location: '/land' });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    async close() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

test('un redirect 302 verso file:// viene bloccato; mailto: è consegnato all\'OS', async ({ app, openTab }) => {
  const srv = await startRedirectServer();
  try {
    // Stub di shell.openExternal nel main (stesso pattern di
    // security-hardening #1b): tabs.js usa lo stesso oggetto `shell` di
    // require('electron'), quindi la sostituzione è visibile al codice reale.
    await app.evaluate(({ shell }) => {
      globalThis.__ext = [];
      shell.openExternal = (u) => { globalThis.__ext.push(String(u)); return Promise.resolve(); };
    });

    const page = await openTab(`${srv.origin}/start`);
    const startUrl = page.url();
    expect(startUrl.endsWith('/start')).toBe(true);

    // a) navigazione verso un endpoint che 302-redirige a file:// — will-navigate
    // vede solo l'URL http (safe), il gate deve scattare su will-redirect.
    await page.evaluate(() => { try { window.location.href = '/to-file'; } catch (_) {} });
    await new Promise((r) => setTimeout(r, 800));

    // Nessuna window/tab deve essere finita su file:.
    const fileWindows = app.windows().filter((w) => {
      try { return w.url().toLowerCase().startsWith('file:'); } catch (_) { return false; }
    });
    expect(fileWindows.length).toBe(0);
    // La pagina non è stata dirottata (il redirect bloccato annulla la navigazione).
    expect(page.url()).toBe(startUrl);

    // b) redirect verso mailto: → delega all'OS. Senza il gate will-redirect
    // NESSUNO consegna il mailto (Chromium fallisce e basta): questo assert è
    // rosso prima del fix e verde solo col fix.
    await page.evaluate(() => { try { window.location.href = '/to-mailto'; } catch (_) {} });
    await new Promise((r) => setTimeout(r, 800));

    const ext = await app.evaluate(() => globalThis.__ext || []);
    expect(ext.some((u) => u.startsWith('mailto:mario@esempio.it'))).toBe(true);
    // file:// non deve MAI arrivare a shell.openExternal.
    expect(ext.some((u) => u.toLowerCase().startsWith('file:'))).toBe(false);
    // Anche dopo il mailto la pagina resta dov'era.
    expect(page.url()).toBe(startUrl);
  } finally {
    await srv.close();
  }
});

test('i redirect legittimi http→http continuano a passare', async ({ openTab }) => {
  const srv = await startRedirectServer();
  try {
    const page = await openTab(`${srv.origin}/start`);
    await page.evaluate(() => { try { window.location.href = '/to-ok'; } catch (_) {} });

    // Il redirect 302 verso /land deve completarsi davvero (asserzione di
    // SUCCESSO: la pagina di destinazione è caricata, non solo "nessun errore").
    await page.waitForFunction(
      () => document.body && document.body.dataset.landed === '1',
      null,
      { timeout: 8000 },
    );
    expect(page.url().endsWith('/land')).toBe(true);
  } finally {
    await srv.close();
  }
});
