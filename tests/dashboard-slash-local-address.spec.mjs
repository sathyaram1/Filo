// #398 — dal campo "nuova scheda" (dashboard), scrivere "/" + un indirizzo LOCALE
// deve APRIRE una scheda su quell'indirizzo, non mandarlo in chat a Filo.
//
// Dopo la rimozione della barra indirizzi della shell, l'unico modo per aprire
// un sito scrivendolo è "/indirizzo" nel campo "Chiedi qualsiasi cosa". Il
// riconoscitore lì pretendeva un TLD alfabetico e scartava localhost, gli IP e i
// nomi locali: "/127.0.0.1:PORT" diventava rosso e all'invio finiva come
// messaggio di chat (nessuna scheda aperta, e con un profilo attivo una richiesta
// sprecata). Questo spec ASSERISCE il successo end-to-end: la scheda si apre
// DAVVERO sull'indirizzo locale (schema http, contenuto caricato). Senza il fix
// (regola "solo TLD alfabetico") diventa rosso: nessuna scheda 127.0.0.1 compare.

import { test, expect } from './fixtures/electron.mjs';

test('#398 "/127.0.0.1:porta" nel campo nuova scheda apre l’indirizzo locale (non va in chat)', async ({ app, shell, openTab, testServer }) => {
  // Server locale reale con una pagina riconoscibile.
  const fullUrl = testServer.html('<!doctype html><title>locale-ok</title><h1 id="marker">locale ok</h1>');
  const typed = fullUrl.replace(/^https?:\/\//, ''); // 127.0.0.1:PORT/ID, come lo digiterebbe l'utente
  expect(typed).toMatch(/^127\.0\.0\.1:\d+\/\d+$/);
  const expectedUrl = `http://${typed}`;

  // Apri la dashboard (la pagina della "nuova scheda") e scrivi "/indirizzo".
  const dash = await openTab('filo://newtab/');
  const input = dash.locator('#input');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  await input.fill('/' + typed);

  // Live coloring: un indirizzo riconosciuto NON deve essere rosso (comando
  // sconosciuto). Prima del fix l'input aveva la classe is-cmd-unknown.
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
  await expect(input).toHaveClass(/is-cmd-filo/);

  // Invio: deve aprire la scheda, non mandare il testo in chat.
  await input.press('Enter');

  // (1) Compare una vista sull'indirizzo locale (schema http) col contenuto servito.
  const deadline = Date.now() + 10_000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => {
      try { return w.url() === expectedUrl; } catch (_) { return false; }
    });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(page, 'deve aprirsi una scheda sull’indirizzo locale (non un messaggio in chat)').toBeTruthy();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await expect(page.locator('#marker')).toHaveText('locale ok', { timeout: 5000 });

  // (2) Il campo si è svuotato (comando eseguito) e l'indirizzo NON è finito in
  //     chat come messaggio dell'utente.
  await expect(input).toHaveValue('');
  const wentToChat = await dash.evaluate((addr) =>
    !!Array.from(document.querySelectorAll('*')).find(
      (el) => el.children.length === 0 && (el.textContent || '').includes(addr)
    ), typed);
  expect(wentToChat, 'l’indirizzo non deve comparire come messaggio in chat').toBe(false);
});
