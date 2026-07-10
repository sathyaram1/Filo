// AUDIT (routine, riproduzione): navigazione fallita = pagina bianca muta.
//
// Flusso utente riprodotto:
//   1. digita in barra un dominio con un refuso (es. "dominio-inesistente-….com")
//      oppure apri un sito col server giù / senza connessione;
//   2. la scheda resta COMPLETAMENTE bianca: nessun messaggio d'errore, nessun
//      "Riprova", il titolo resta "Nuova scheda". In Chrome comparirebbe la
//      pagina d'errore (ERR_NAME_NOT_RESOLVED / ERR_CONNECTION_REFUSED).
//
// Causa: did-fail-load in src/main/tabs.js è solo loggato (e solo fuori
// produzione); il frame finisce su chrome-error://chromewebdata/ vuoto.
//
// Il test asserisce lo stato ATTUALE (frame d'errore Chromium vuoto, nessuna
// pagina d'errore interna): documenta il problema restando verde. Il fix atteso
// (una pagina d'errore con motivo e "Riprova" caricata su did-fail-load) lo farà
// fallire, e a quel punto va aggiornato per asserire il comportamento nuovo.

import { test, expect } from './fixtures/electron.mjs';

test('dominio inesistente: la tab resta un frame d\'errore vuoto (nessuna pagina d\'errore)', async ({ app, shell }) => {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'https://dominio-inesistente-refuso-xyz.com/');

  // Il frame fallito approda su chrome-error://chromewebdata/ (default Chromium
  // senza gestione applicativa).
  let errWin = null;
  await expect.poll(() => {
    errWin = app.windows().find((w) => {
      try { return w.url().startsWith('chrome-error://'); } catch (_) { return false; }
    });
    return !!errWin;
  }, { timeout: 15_000 }).toBe(true);

  // Stato ATTUALE (il bug): il corpo del frame d'errore è vuoto → l'utente vede
  // solo bianco, senza spiegazione né azioni. Nessuna pagina interna di errore
  // viene caricata al suo posto.
  const bodyText = await errWin.evaluate(() => (document.body ? document.body.innerText.trim() : ''))
    .catch(() => '');
  expect(bodyText).toBe('');

  const snap = await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.map((t) => ({ url: t.url, title: t.title }));
  });
  // La tab esiste ancora, con l'URL fallito e il titolo placeholder: niente
  // segnala all'utente che il caricamento è fallito.
  const failed = snap.find((t) => /dominio-inesistente-refuso-xyz\.com/.test(t.url || ''));
  expect(failed).toBeTruthy();
  expect(failed.title).toBe('Nuova scheda');
  // Nessuna pagina d'errore interna (filo://…) ha sostituito il frame.
  expect(app.windows().some((w) => { try { return /filo:\/\/.*(error|errore)/.test(w.url()); } catch (_) { return false; } })).toBe(false);
});

test('connessione rifiutata: stessa pagina bianca muta', async ({ app, shell }) => {
  // Porta locale chiusa → ERR_CONNECTION_REFUSED.
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'http://127.0.0.1:59999/');

  let errWin = null;
  await expect.poll(() => {
    errWin = app.windows().find((w) => {
      try { return w.url().startsWith('chrome-error://'); } catch (_) { return false; }
    });
    return !!errWin;
  }, { timeout: 15_000 }).toBe(true);

  const bodyText = await errWin.evaluate(() => (document.body ? document.body.innerText.trim() : ''))
    .catch(() => '');
  expect(bodyText).toBe('');
});
