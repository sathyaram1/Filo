// #327 — pagina d'errore di rete (sostituisce tests/audit-failnav-blank.spec.mjs,
// che asseriva il bug: scheda completamente bianca su navigazione fallita).
//
// Comportamento atteso ADESSO:
//   - dominio inesistente / server giù → la scheda mostra la pagina d'errore
//     interna (filo://error) con motivo tradotto e bottone "Riprova";
//   - il titolo della scheda diventa il sito fallito (non resta "Nuova scheda");
//   - per l'utente la scheda resta sull'URL fallito (snapshot/sessione);
//   - "Riprova" ritenta DAVVERO: se nel frattempo il server è tornato su, la
//     pagina si carica (assert di successo, non di assenza d'errore);
//   - renderer crashato → stessa pagina d'errore ("scheda bloccata") + Riprova.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { lento } from './fixtures/tempi.mjs';

// La Page della pagina d'errore interna (filo://error/…), appena compare.
async function waitErrorPage(app, timeout = lento(20_000)) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => {
      try { return w.url().startsWith('filo://error/'); } catch (_) { return false; }
    });
    return !!page;
  }, { timeout }).toBe(true);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page;
}

test('dominio inesistente: pagina d\'errore con motivo e Riprova, titolo = sito fallito', async ({ app, shell }) => {
  const failedUrl = 'https://dominio-inesistente-refuso-xyz.com/';
  await shell.evaluate((u) => window.filoShell.tabs.open(u), failedUrl);

  const errPage = await waitErrorPage(app);

  // La pagina spiega l'errore (titolo non vuoto) e offre "Riprova".
  const title = await errPage.locator('#err-title').innerText();
  expect(title.trim().length).toBeGreaterThan(0);
  await expect(errPage.locator('#err-retry')).toBeVisible();
  // Il sito fallito è riconoscibile sulla pagina.
  await expect(errPage.locator('#err-host')).toHaveText(/dominio-inesistente-refuso-xyz\.com/);

  // La scheda: titolo = host fallito (non più "Nuova scheda"), URL = quello
  // fallito (la pagina d'errore è invisibile a snapshot/sessione).
  await expect.poll(async () => {
    const s = await shell.evaluate(async () => {
      const snap = await window.filoShell.tabs.snapshot();
      return snap.tabs.map((t) => ({ url: t.url, title: t.title }));
    });
    const tab = s.find((t) => /dominio-inesistente-refuso-xyz\.com/.test(t.url || ''));
    return tab ? tab.title : '';
  }, { timeout: lento(10_000) }).toMatch(/dominio-inesistente-refuso-xyz\.com/);

  // Traccia visiva della run (gitignorata).
  await errPage.screenshot({ path: 'tests/.shots/net-error-dns.png' }).catch(() => {});
});

test('server giù poi su: "Riprova" carica davvero la pagina', async ({ app, shell }) => {
  // Prendi una porta libera e chiudila subito: la navigazione fallirà
  // (ERR_CONNECTION_REFUSED) finché non riavviamo un server VERO su quella porta.
  const probe = createServer(() => {});
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));

  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://127.0.0.1:${port}/`);
  const errPage = await waitErrorPage(app);
  await expect(errPage.locator('#err-retry')).toBeVisible();

  // Il server "torna su" sulla stessa porta.
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><title>tornato</title><h1 id="ok">di nuovo online</h1>');
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));

  try {
    await errPage.click('#err-retry');
    // Assert di SUCCESSO: la stessa scheda ora mostra il contenuto del sito.
    await expect.poll(() => {
      const w = app.windows().find((p) => {
        try { return p.url() === `http://127.0.0.1:${port}/`; } catch (_) { return false; }
      });
      return !!w;
    }, { timeout: lento(15_000) }).toBe(true);
    const page = app.windows().find((p) => {
      try { return p.url() === `http://127.0.0.1:${port}/`; } catch (_) { return false; }
    });
    await expect(page.locator('#ok')).toHaveText('di nuovo online');
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('renderer crashato: pagina d\'errore "scheda bloccata" invece del bianco', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<!DOCTYPE html><title>viva</title><p>contenuto</p>');
  await openTab(url);

  // Ammazza il renderer della SCHEDA dal main process. Attenzione: altri
  // servizi di Filo aprono lo stesso URL in finestre nascoste — la scheda è
  // il webContents che appartiene alla finestra principale (quella visibile,
  // che ospita anche la shell).
  await app.evaluate(({ webContents, BrowserWindow }, target) => {
    const shellWc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('filo://shell/'));
    const mainWin = BrowserWindow.fromWebContents(shellWc);
    const wc = webContents.getAllWebContents().find((w) =>
      w.getURL() === target && BrowserWindow.fromWebContents(w) === mainWin);
    if (!wc) throw new Error('webContents della scheda non trovato');
    wc.forcefullyCrashRenderer();
  }, url);

  const errPage = await waitErrorPage(app);
  await expect(errPage.locator('#err-title')).toHaveText(/bloccata/i);
  await expect(errPage.locator('#err-retry')).toBeVisible();

  // "Riprova" ricarica il sito (che è vivo): assert di successo.
  await errPage.click('#err-retry');
  await expect.poll(() => {
    const w = app.windows().find((p) => {
      try { return p.url() === url; } catch (_) { return false; }
    });
    return !!w;
  }, { timeout: lento(15_000) }).toBe(true);
});
