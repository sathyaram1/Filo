// Spec: la bacheca (filo://board/) NON mente quando il caricamento fallisce.
//
// Regressione #396: senza rete, loadData() intercettava l'eccezione di FB.list(),
// azzerava la lista e mostrava "Nessun miglioramento da verificare per ora." —
// identico allo stato "davvero vuoto". L'utente non poteva capire che era un
// problema di rete, non c'era un modo per riprovare, e l'attesa era muta ~13 s.
//
// Assert di COMPORTAMENTO (successo della feature, non assenza di errore):
//   1. Quando la fetch fallisce, compare uno STATO D'ERRORE distinto (#bdError)
//      con una frase in ITALIANO comprensibile (connessione + riprova) e un tasto
//      "Riprova"; lo stato vuoto (#bdEmpty) resta NASCOSTO — non si spaccia il
//      fallimento per "niente da votare".
//   2. Il messaggio grezzo dell'eccezione ("Failed to fetch") NON compare.
//   3. "Riprova" rilancia il caricamento: se stavolta va a buon fine, l'errore
//      sparisce e i miglioramenti compaiono come schede votabili.
//
// Esercita il cammino REALE (loadData → FB.list → showLoadError) sostituendo la
// sorgente dati (hook __boardTest.setList) con una funzione che rigetta/risolve,
// poi rilanciando il caricamento. Non serve simulare la rete davvero assente.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://board/board.html';

// Un fix pulito, chiuso e rilasciato → DEVE comparire dopo un retry riuscito.
const SHIPPED = {
  _id: 'fb-shipped-retry',
  name: 'Fix comparso dopo il retry',
  status: 'done',
  resolvedInVersion: '0.2.70',
  seq: 77, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-20T10:00:00Z',
  votes: {},
};

// Aspetta che i moduli e l'hook di test ci siano e che il caricamento reale
// iniziale (FB.list live) si sia concluso (loader nascosto): solo dopo possiamo
// sostituire FB.list e rilanciare in modo deterministico.
async function ready(page) {
  await page.waitForFunction(
    () => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW && window.SN_CHAT_ERRORS,
    null,
    { timeout: 15_000 },
  );
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
}

test('caricamento fallito: stato d\'errore con Riprova, NON "nessun miglioramento"', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await ready(page);

  // Fissa una versione rilasciata (così un eventuale retry riuscito mostra il
  // fix) e fai fallire la prossima fetch come farebbe il renderer offline
  // ("Failed to fetch" è proprio ciò che lancia il fetch di Chromium senza rete).
  await page.evaluate(() => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setList(() => Promise.reject(new TypeError('Failed to fetch')));
  });
  await page.evaluate(() => window.__boardTest.reload());

  // Stato d'errore visibile, stato vuoto nascosto, lista nascosta.
  const err = page.locator('#bdError');
  await expect(err).toBeVisible();
  await expect(page.locator('#bdEmpty')).toBeHidden();
  await expect(page.locator('#bdList')).toBeHidden();
  await expect(page.locator('#bdLoading')).toBeHidden();

  // Frase per l'utente: parla di connessione e invita a riprovare, in italiano.
  const msg = await page.locator('#bdErrorMsg').innerText();
  expect(msg.toLowerCase()).toContain('connessione');
  expect(msg.toLowerCase()).toContain('riprova');
  // Mai il messaggio grezzo dell'eccezione.
  expect(msg.toLowerCase()).not.toContain('failed to fetch');

  // Il tasto Riprova è presente e cliccabile.
  await expect(page.locator('#bdRetry')).toBeVisible();
});

test('Riprova recupera: dopo un caricamento riuscito il fix compare come scheda votabile', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await ready(page);

  // Primo giro: fallisce → stato d'errore.
  await page.evaluate(() => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setList(() => Promise.reject(new TypeError('Failed to fetch')));
  });
  await page.evaluate(() => window.__boardTest.reload());
  await expect(page.locator('#bdError')).toBeVisible();

  // Ora la rete "torna": la prossima fetch risolve col fix in produzione.
  await page.evaluate((shipped) => {
    window.__boardTest.setList(() => Promise.resolve([shipped]));
  }, SHIPPED);

  // Clic su Riprova → il caricamento riparte e va a buon fine.
  await page.locator('#bdRetry').click();

  // L'errore sparisce e il fix compare come scheda con i pulsanti di voto.
  await expect(page.locator('#bdError')).toBeHidden();
  await expect(page.locator('.bd-card')).toHaveCount(1);
  await expect(page.locator('.bd-card-title')).toHaveText('Fix comparso dopo il retry');
  await expect(page.locator('.bd-card .bd-vote-works')).toHaveCount(1);
  await expect(page.locator('.bd-card .bd-vote-broken')).toHaveCount(1);
});

// Il guasto va RICORDATO, non disegnato una volta sola: qualunque ridisegno
// successivo (qui il login dal banner "Accedi per votare") ripartiva da una
// lista vuota e rimpiazzava l'errore con "Nessun miglioramento…", portandosi
// via il tasto Riprova. Stessa regola dei conteggi (#495): un vuoto è
// un'affermazione, e dopo un caricamento fallito non la sappiamo.
//
// Precondizione senza il fix: dopo il login #bdError è nascosto e #bdEmpty
// visibile → i primi due assert diventano rossi.
test('caricamento fallito: un login (o altro ridisegno) non cancella l\'errore', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await ready(page);

  await page.evaluate(() => {
    window.__boardTest.setList(() => Promise.reject(new TypeError('Failed to fetch')));
  });
  await page.evaluate(() => window.__boardTest.reload());
  await expect(page.locator('#bdError')).toBeVisible();

  // L'utente accede per votare: la pagina si ridisegna.
  await page.evaluate(() => window.__boardTest.setSignedIn('tester@example.com'));

  await expect(page.locator('#bdError')).toBeVisible();
  await expect(page.locator('#bdEmpty')).toBeHidden();
  await expect(page.locator('#bdRetry')).toBeVisible();

  // E il retry funziona ancora: rete tornata → i miglioramenti compaiono.
  await page.evaluate((shipped) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setList(() => Promise.resolve([shipped]));
  }, SHIPPED);
  await page.locator('#bdRetry').click();
  await expect(page.locator('#bdError')).toBeHidden();
  await expect(page.locator('.bd-card')).toHaveCount(1);
});
