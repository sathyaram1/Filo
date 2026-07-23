// #233 — la barra degli indirizzi deve APRIRE un indirizzo "host:porta" scritto
// senza schema, non trasformarlo in una ricerca Google.
//
// Prima del fix, digitare "127.0.0.1:<porta>/<id>" (o "localhost:3000") finiva
// su https://www.google.com/search?q=... perché il riconoscitore di URL non
// ammetteva la parte ":porta". Questo spec ASSERISCE il successo end-to-end:
// dopo la navigazione la scheda è DAVVERO sull'indirizzo locale servito (schema
// http, contenuto caricato), NON su una ricerca. Senza il fix diventa rosso.

import { test, expect } from './fixtures/electron.mjs';

test('#233 barra indirizzi: "host:porta" senza schema apre l’indirizzo (non cerca)', async ({ shell, testServer }) => {
  // Un server locale reale su 127.0.0.1:<porta> con una pagina riconoscibile.
  const fullUrl = testServer.html('<!doctype html><title>porta-ok</title><h1 id="marker">porta ok</h1>');
  // Ciò che l’utente digiterebbe nella barra: host:porta/path SENZA "http://".
  const typed = fullUrl.replace(/^https?:\/\//, '');
  expect(typed).toMatch(/^127\.0\.0\.1:\d+\/\d+$/);

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

  // Attende che la scheda si stabilizzi sull’indirizzo locale.
  const expectedUrl = `http://${typed}`;
  await expect
    .poll(async () => {
      const snap = await shell.evaluate(async () => window.filoShell.tabs.snapshot());
      const tab = (snap.tabs || []).find((t) => t.id === openId);
      return tab ? tab.url : null;
    }, { timeout: 8000, message: 'la scheda deve navigare all’indirizzo host:porta' })
    .toBe(expectedUrl);

  // Difesa esplicita del sintomo del feedback: NON deve essere una ricerca Google.
  const snap = await shell.evaluate(async () => window.filoShell.tabs.snapshot());
  const tab = (snap.tabs || []).find((t) => t.id === openId);
  expect(String(tab.url)).not.toContain('google.com/search');

  // E il contenuto servito dal server locale è davvero caricato (successo reale,
  // non solo "URL cambiato").
  const target = new URL(expectedUrl).host;
  const deadline = Date.now() + 8000;
  let page = null;
  while (Date.now() < deadline) {
    page = shell.context().pages?.() // playwright electron: usa app windows via shell
      ? null : null;
    break;
  }
  // Recupera la Page del WebContentsView tramite le finestre dell'app.
  const app = shell.context().browser?.() || null;
  // Fallback robusto: interroga il DOM della pagina via il main non è possibile
  // qui, quindi verifichiamo il titolo dallo snapshot della scheda.
  expect(String(tab.title || ''), 'il titolo della pagina locale deve comparire').toContain('porta-ok');
});
