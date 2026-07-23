// #233 — la barra degli indirizzi deve APRIRE un indirizzo "host:porta" scritto
// senza schema, non trasformarlo in una ricerca Google.
//
// Prima del fix, digitare "127.0.0.1:<porta>/<id>" (o "localhost:3000") finiva
// su https://www.google.com/search?q=... perché il riconoscitore di URL non
// ammetteva la parte ":porta". Questo spec ASSERISCE il successo end-to-end:
// dopo la navigazione la scheda è DAVVERO sull'indirizzo locale servito (schema
// http, contenuto caricato), NON su una ricerca. Senza il fix diventa rosso.

import { test, expect } from './fixtures/electron.mjs';

test('#233 barra indirizzi: "host:porta" senza schema apre l’indirizzo (non cerca)', async ({ app, shell, testServer }) => {
  // Un server locale reale su 127.0.0.1:<porta> con una pagina riconoscibile.
  const fullUrl = testServer.html('<!doctype html><title>porta-ok</title><h1 id="marker">porta ok</h1>');
  // Ciò che l’utente digiterebbe nella barra: host:porta/path SENZA "http://".
  const typed = fullUrl.replace(/^https?:\/\//, '');
  expect(typed).toMatch(/^127\.0\.0\.1:\d+\/\d+$/);
  const expectedUrl = `http://${typed}`;

  // Scheda di partenza.
  const openId = await shell.evaluate(async () => {
    const r = await window.filoShell.tabs.open('filo://newtab/');
    return r && r.id;
  });
  expect(openId, 'la scheda di partenza deve aprirsi').toBeTruthy();
  await new Promise((r) => setTimeout(r, 300));

  // Naviga con l’indirizzo schemeless, come farebbe la barra indirizzi.
  await shell.evaluate(async ({ id, url }) => {
    await window.filoShell.tabs.navigate(id, url);
  }, { id: openId, url: typed });

  // (1) Lo snapshot della scheda deve puntare all’indirizzo locale (schema http),
  //     NON a una ricerca Google.
  await expect
    .poll(async () => {
      const snap = await shell.evaluate(async () => window.filoShell.tabs.snapshot());
      const tab = (snap.tabs || []).find((t) => t.id === openId);
      return tab ? tab.url : null;
    }, { timeout: 8000, message: 'la scheda deve navigare all’indirizzo host:porta' })
    .toBe(expectedUrl);

  const snap = await shell.evaluate(async () => window.filoShell.tabs.snapshot());
  const tab = (snap.tabs || []).find((t) => t.id === openId);
  expect(String(tab.url)).not.toContain('google.com/search');

  // (2) Successo reale: il contenuto servito dal server locale è davvero
  //     caricato nella WebContentsView (trova la Page per URL e verifica il DOM).
  const deadline = Date.now() + 8000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => {
      try { return w.url() === expectedUrl; } catch (_) { return false; }
    });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(page, 'deve esistere una vista sull’indirizzo locale').toBeTruthy();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await expect(page.locator('#marker')).toHaveText('porta ok', { timeout: 5000 });
});
