// SICUREZZA (#309) — gate schemi non-web sui REDIRECT lato server.
//
// Il gate isWebUnsafeNav (#247) copre will-navigate e setWindowOpenHandler, ma
// will-navigate NON scatta sui redirect 301/302: senza un handler will-redirect
// il caso "302 verso schema non-web" si affidava solo al comportamento
// implicito di Chromium, fuori dall'invariante esplicita di Filo.
//
// Cosa fa davvero Chromium (misurato con un harness diagnostico su questa
// versione di Electron):
//   - 302 → file:// (e simili "unsafe redirect"): il network layer fallisce con
//     ERR_UNSAFE_REDIRECT PRIMA che will-redirect venga emesso. Il gate Filo su
//     quel cammino è pura difesa in profondità (irraggiungibile finché Chromium
//     mantiene quel blocco) — il test ne asserisce l'INVARIANTE osservabile:
//     nessuna window file://, mai file:// a shell.openExternal.
//   - 302 → protocollo esterno (mailto:, tel:, schemi app arbitrari):
//     will-redirect VIENE emesso con l'URL di destinazione. Qui il gate Filo è
//     l'UNICA difesa esplicita: blocca lo schema e consegna all'OS solo
//     l'allowlist mailto:/tel:/sms:. Senza il fix l'assert sulla consegna del
//     mailto: è ROSSO (nessuno la fa) — è l'assert che discrimina fix/non-fix,
//     in parità col cammino will-navigate (test #1b di security-hardening).
//   - 302 → http(s): passa dal gate (schema web-safe) e completa normalmente.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

// Mini server con endpoint di redirect: il testServer del fixture serve solo
// pagine 200, qui servono risposte 302 con Location arbitraria.
async function startRedirectServer() {
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/start') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>start</title><body><p>partenza</p>');
      return;
    }
    if (path === '/land') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>land</title><body data-landed="1"><p>arrivato</p>');
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

// Stub di shell.openExternal nel main (stesso pattern di security-hardening
// #1b): tabs.js usa lo stesso oggetto `shell` di require('electron'), quindi
// la sostituzione è visibile al codice reale.
async function stubOpenExternal(app) {
  await app.evaluate(({ shell }) => {
    globalThis.__ext = [];
    shell.openExternal = (u) => { globalThis.__ext.push(String(u)); return Promise.resolve(); };
  });
}

test('un redirect 302 verso mailto: passa dal gate Filo: pagina non dirottata, consegna all\'OS', async ({ app, openTab }) => {
  const srv = await startRedirectServer();
  try {
    await stubOpenExternal(app);
    const page = await openTab(`${srv.origin}/start`);
    const startUrl = page.url();
    expect(startUrl.endsWith('/start')).toBe(true);

    // will-navigate vede solo l'URL http intermedio (web-safe, passa); il gate
    // deve scattare su will-redirect con l'URL mailto: di destinazione.
    await page.evaluate(() => { try { window.location.href = '/to-mailto'; } catch (_) {} });
    await new Promise((r) => setTimeout(r, 800));

    // Assert discriminante (rosso senza il gate will-redirect): il mailto:
    // arrivato via redirect viene CONSEGNATO all'OS, come quello via click.
    const ext = await app.evaluate(() => globalThis.__ext || []);
    expect(ext.some((u) => u.startsWith('mailto:mario@esempio.it'))).toBe(true);

    // E la scheda NON è stata dirottata: il preventDefault del gate annulla la
    // navigazione e la pagina resta esattamente dov'era (niente error page).
    expect(page.url()).toBe(startUrl);
  } finally {
    await srv.close();
  }
});

test('un redirect 302 verso file:// non produce mai una window file:// né una consegna all\'OS', async ({ app, openTab }) => {
  const srv = await startRedirectServer();
  try {
    await stubOpenExternal(app);
    const page = await openTab(`${srv.origin}/start`);

    await page.evaluate(() => { try { window.location.href = '/to-file'; } catch (_) {} });
    await new Promise((r) => setTimeout(r, 800));

    // INVARIANTE (#247/#309): nessuna window/tab su file:, in nessun caso.
    // (Oggi il blocco concreto avviene nel network layer di Chromium con
    // ERR_UNSAFE_REDIRECT prima di will-redirect; il gate Filo resta come
    // difesa in profondità se quel comportamento cambiasse.)
    const fileWindows = app.windows().filter((w) => {
      try { return w.url().toLowerCase().startsWith('file:'); } catch (_) { return false; }
    });
    expect(fileWindows.length).toBe(0);
    expect(page.url().toLowerCase().startsWith('file:')).toBe(false);

    // file:// non deve MAI arrivare a shell.openExternal (l'allowlist OS è
    // solo mailto:/tel:/sms:).
    const ext = await app.evaluate(() => globalThis.__ext || []);
    expect(ext.some((u) => u.toLowerCase().startsWith('file:'))).toBe(false);
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
