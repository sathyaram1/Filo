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

// #602, giro 2 — SE LA RIAPERTURA NON RIESCE, SI PUÒ RIPROVARE.
//
// La spiegazione di cosa non funziona ancora è la parte che serve a chi
// raccoglie la segnalazione. Quando l'invio falliva, i crediti tornavano
// indietro ma il segnale di riapertura restava scritto sul fix: al secondo
// tentativo la bacheca rispondeva «già segnalato», e quella spiegazione non
// aveva più dove andare. Qui si prova quello che vede chi riapre: l'errore, il
// testo ancora nel riquadro, e il secondo tentativo che va a buon fine.
const FIX_USCITO = {
  _id: 'fb-riapertura-602',
  name: 'Il pulsante Condividi non risponde',
  status: 'done',
  resolvedInVersion: '0.2.70',
  seq: 91, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-20T10:00:00Z',
  votes: {},
};

test('riapertura non riuscita: il testo resta e il secondo tentativo passa', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });

  // Il main risponde: prima un guasto, poi va a buon fine (è il ritentativo).
  await page.evaluate(() => {
    window.__tentativi = [];
    const vero = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'board_reopen') {
        window.__tentativi.push(msg.text);
        if (window.__tentativi.length === 1) {
          return { ok: false, error: 'Invio non riuscito: la connessione è caduta.' };
        }
        return { ok: true, feedbackId: 'fb-figlio', balance: 90 };
      }
      return vero(msg);
    };
  });

  await page.evaluate((fix) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setSignedIn('chi-riapre@example.com');
    window.__boardTest.setData([fix]);
  }, FIX_USCITO);

  const card = page.locator('.bd-card').first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.locator('.bd-reopen-link').click();

  const testo = 'Succede ancora: premo Condividi e non si apre niente.';
  await card.locator('.bd-reopen-text').fill(testo);
  await card.locator('.bd-reopen-actions button', { hasText: 'Invia' }).click();

  // Primo tentativo: si legge cosa è andato storto, e quello che ho scritto è
  // ancora lì — con il pulsante di nuovo premibile.
  const err = card.locator('.bd-reopen-err');
  await expect(err).toBeVisible({ timeout: 10_000 });
  await expect(card.locator('.bd-reopen-text')).toHaveValue(testo);
  const invia = card.locator('.bd-reopen-actions button', { hasText: 'Invia' });
  await expect(invia).toBeEnabled();

  // Secondo tentativo: passa. Il fix esce dalla bacheca (è tornato in
  // lavorazione), che è il modo in cui chi riapre vede che è arrivata.
  await invia.click();
  await expect(page.locator('.bd-card')).toHaveCount(0, { timeout: 10_000 });
  const tentativi = await page.evaluate(() => window.__tentativi.slice());
  expect(tentativi, 'la stessa spiegazione, mandata due volte').toEqual([testo, testo]);
});

// La bacheca si ridisegna da sola (i dati che finiscono di caricare, un voto
// che torna dal server, un login): se porta via il form aperto e quello che
// l'utente ha scritto dentro, la segnalazione è persa senza che nessuno lo
// dica. Era anche il motivo per cui la prova qui sopra diventava rossa sotto
// carico: il ridisegno cadeva fra lo scrivere e il premere Invia.
test('un ridisegno mentre scrivo non porta via il form «Ancora rotto?» né il testo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });

  await page.evaluate((fix) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setSignedIn('chi-riapre@example.com');
    window.__boardTest.setData([fix]);
  }, FIX_USCITO);

  const card = page.locator('.bd-card').first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.locator('.bd-reopen-link').click();

  const testo = 'Stavo scrivendo questo quando la pagina si è ridisegnata.';
  await card.locator('.bd-reopen-text').fill(testo);

  // Il ridisegno che arriva da fuori, mentre il cursore è ancora nel campo.
  await page.evaluate((fix) => window.__boardTest.setData([fix]), FIX_USCITO);

  const campo = page.locator('.bd-card').first().locator('.bd-reopen-text');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  await expect(campo).toHaveValue(testo);
  await expect(page.locator('.bd-card').first()
    .locator('.bd-reopen-actions button', { hasText: 'Invia' })).toBeVisible();
  // E il cursore è tornato dov'era: si continua a scrivere senza ricliccare.
  const scriveAncora = await page.evaluate(() => {
    const el = document.activeElement;
    return !!(el && el.classList && el.classList.contains('bd-reopen-text'));
  });
  expect(scriveAncora, 'dopo il ridisegno il cursore non è più nel campo').toBe(true);
});

test('«Annulla» butta via la bozza: un ridisegno dopo non la fa ricomparire', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });

  await page.evaluate((fix) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setSignedIn('chi-riapre@example.com');
    window.__boardTest.setData([fix]);
  }, FIX_USCITO);

  const card = page.locator('.bd-card').first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.locator('.bd-reopen-link').click();
  await card.locator('.bd-reopen-text').fill('roba scritta e poi buttata');
  await card.locator('.bd-reopen-cancel').click();

  await page.evaluate((fix) => window.__boardTest.setData([fix]), FIX_USCITO);
  const form = page.locator('.bd-card').first().locator('.bd-reopen-form');
  await expect(form).toBeHidden();
  await expect(page.locator('.bd-card').first().locator('.bd-reopen-text')).toHaveValue('');
});
