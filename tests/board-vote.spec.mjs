// Spec Playwright per il voto della bacheca (DC2): IPC BOARD_CAST_VOTE /
// BOARD_CLEAR_VOTE verso il main.
//
// Assert di COMPORTAMENTO, non solo "non crasha":
//   - senza sessione (nessun login Google reale nell'ambiente di test — vedi
//     auth-pkce.spec.mjs, non simulabile da Playwright) l'IPC risponde con un
//     errore esplicito "Accedi per votare…", SENZA scrivere su Firestore né
//     accreditare crediti — è la riprova server-side dell'invariante "per
//     votare serve il login" che la pagina applica anche lato renderer;
//   - la forma della risposta è quella su cui il renderer (board.js) si
//     appoggia per il toggle works/broken e per il revert ottimistico;
//   - un id mancante o un voto non valido sono rifiutati con un messaggio
//     chiaro (niente eccezioni non gestite che farebbero apparire la pagina
//     bloccata).
//
// Il percorso "voto autenticato → scrittura reale su Firestore → +10 crediti
// una sola volta" è coperto a livello di logica pura da
// tests/unit/creditStore.test.mjs (isVoteRewardPending/awardVoteOnce), che gira
// senza Electron né rete: qui verifichiamo il contratto IPC end-to-end nel
// processo main reale, dove possiamo eseguirlo senza credenziali Google.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://board/board.html';

async function callIpc(page, msg) {
  return page.evaluate((m) => window.filo.message(m), msg);
}

test('BOARD_CAST_VOTE senza sessione: errore esplicito, niente scrittura né crediti', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const r = await callIpc(page, { type: 'board_cast_vote', id: 'fb-qualunque', vote: 'works' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/accedi/i);
  // Nessun campo di scrittura riuscita: il renderer deve poter distinguere
  // l'errore da un voto andato a buon fine.
  expect(r.awarded).toBeUndefined();
  expect(r.votes).toBeUndefined();
});

test('BOARD_CLEAR_VOTE senza sessione: stesso errore, nessuna eccezione', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const r = await callIpc(page, { type: 'board_clear_vote', id: 'fb-qualunque' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/accedi/i);
});

test('BOARD_CAST_VOTE rifiuta voto non valido con messaggio chiaro (non crasha)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const r = await callIpc(page, { type: 'board_cast_vote', id: 'fb-qualunque', vote: 'maybe' });
  expect(r.ok).toBe(false);
  // Senza sessione il gate di login vince per primo: il messaggio resta
  // comunque comprensibile e la pagina resta viva (niente throw).
  expect(typeof r.error).toBe('string');
  expect(r.error.length).toBeGreaterThan(0);
});

test('BOARD_CAST_VOTE rifiuta id mancante con messaggio chiaro', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const r = await callIpc(page, { type: 'board_cast_vote', id: '', vote: 'works' });
  expect(r.ok).toBe(false);
  expect(typeof r.error).toBe('string');
});
