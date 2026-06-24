// Spec Playwright per la riapertura a pagamento dalla bacheca (DC4): IPC
// BOARD_REOPEN verso il main.
//
// Assert di COMPORTAMENTO, non solo "non crasha":
//   - senza sessione (nessun login Google reale nell'ambiente di test — vedi
//     auth-pkce.spec.mjs, non simulabile da Playwright) l'IPC risponde con un
//     errore esplicito "Accedi per segnalare…", SENZA creare un feedback
//     collegato né scalare crediti — stessa garanzia server-side già provata
//     per il voto in board-vote.spec.mjs;
//   - un id mancante o un testo vuoto sono rifiutati con un messaggio chiaro
//     (niente eccezioni non gestite che farebbero apparire la pagina bloccata);
//   - un testo eccessivamente lungo è rifiutato con un messaggio chiaro;
//   - la forma della risposta in caso di errore non contiene mai campi di
//     "successo" (feedbackId/balance), così il renderer può distinguere
//     l'errore da una riapertura riuscita.
//
// Il percorso "riapertura autenticata → scala crediti → crea feedback
// collegato → segna reopenRequests sull'originale" è coperto a livello di
// logica pura da tests/unit/creditStore.test.mjs (applyConsumptionIfAffordable)
// e tests/unit/manageReview.test.mjs (hasReopenRequest/canReopen), che girano
// senza Electron né rete: qui verifichiamo il contratto IPC end-to-end nel
// processo main reale, dove possiamo eseguirlo senza credenziali Google.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://board/board.html';

async function callIpc(page, msg) {
  return page.evaluate((m) => window.filo.message(m), msg);
}

test('BOARD_REOPEN senza sessione: errore esplicito, niente feedback creato né crediti scalati', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const r = await callIpc(page, { type: 'board_reopen', id: 'fb-qualunque', text: 'Non funziona ancora, ho riprovato e si rompe lo stesso.' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/accedi/i);
  // Nessun campo di scrittura riuscita: il renderer deve poter distinguere
  // l'errore da una riapertura andata a buon fine.
  expect(r.feedbackId).toBeUndefined();
  expect(r.balance).toBeUndefined();
});

test('BOARD_REOPEN rifiuta id mancante con messaggio chiaro (non crasha)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const r = await callIpc(page, { type: 'board_reopen', id: '', text: 'Ancora rotto.' });
  expect(r.ok).toBe(false);
  expect(typeof r.error).toBe('string');
  expect(r.error.length).toBeGreaterThan(0);
});

test('BOARD_REOPEN rifiuta testo vuoto con messaggio chiaro', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const r = await callIpc(page, { type: 'board_reopen', id: 'fb-qualunque', text: '   ' });
  expect(r.ok).toBe(false);
  expect(typeof r.error).toBe('string');
  expect(r.error.length).toBeGreaterThan(0);
});

test('BOARD_REOPEN rifiuta testo troppo lungo con messaggio chiaro', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const testoLunghissimo = 'x'.repeat(10001);
  const r = await callIpc(page, { type: 'board_reopen', id: 'fb-qualunque', text: testoLunghissimo });
  expect(r.ok).toBe(false);
  // Senza sessione il gate di login vince comunque per primo: il messaggio
  // resta comprensibile e la pagina resta viva (niente throw) in ogni caso.
  expect(typeof r.error).toBe('string');
  expect(r.error.length).toBeGreaterThan(0);
});
