// #553 giro 1 — con che faccia Filo bussa a un sito.
//
// La richiesta che Filo manda per leggere una pagina si presenta come «node».
// È la firma che i filtri anti-bot dei siti (Cloudflare e simili) riconoscono
// per prima, e a cui rispondono con una pagina di blocco o con un 403: sui siti
// che la usano la lettura non riesce, e Filo può solo riferire l'errore.
// L'alternativa gratis ce l'ha in casa: è un browser, e una sua finestra bussa
// già con un nome di browser.
//
// Nessuna richiesta esce davvero: la fetch del processo principale è sostituita
// e registra gli header.

import { test, expect } from '../../fixtures/electron.mjs';

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('la richiesta si presenta come un browser, non come uno script', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');

  const { inviati, browser } = await app.evaluate(async () => {
    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    let visti = {};
    globalThis.fetch = async (u, opts) => {
      visti = {};
      // Solo gli header che Filo sceglie: quello che non c'è qui lo riempie
      // node con il suo valore di serie, che è la stringa «node».
      new Headers((opts && opts.headers) || {}).forEach((v, k) => { visti[k.toLowerCase()] = v; });
      return new Response('<html><body><main><p>ok</p></main></body></html>', {
        status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    };
    await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: 'https://example.com/pagina' });
    const { session } = require('electron');
    return { inviati: visti, browser: session.defaultSession.getUserAgent() };
  });

  // Il nome con cui Filo apre le pagine nelle sue schede.
  expect(browser).toContain('Chrome');

  // Chi legge per conto dell'utente si presenta come il browser che è.
  const ua = String(inviati['user-agent'] || '');
  expect(ua).not.toBe('node');
  expect(ua).not.toBe('');
});
