// Spec Playwright per la bacheca utente (filo://board/, DC1 + DC2).
//
// Assert di COMPORTAMENTO (asserisce il SUCCESSO della feature, non l'assenza
// di un errore):
//   - un non-owner apre la bacheca e VEDE i fix in produzione (done/verified +
//     spediti) come schede VOTABILI (titolo sicuro + pulsanti funziona/non-funziona);
//   - NON vede nulla del red-team: niente stato, priorità, verdetti dei giudici,
//     testo del feedback bloccato, mittente, pipeline. Un feedback "attack" anche
//     se chiuso NON compare e il suo testo/verdetti non sono nel DOM;
//   - anonimo → invito ad accedere; loggato → il voto (DC2) passa dall'IPC
//     BOARD_CAST_VOTE/BOARD_CLEAR_VOTE verso il main, che scrive su Firestore
//     con l'idToken e accredita i crediti — vedi tests/board-vote.spec.mjs per
//     il dettaglio del flusso IPC e tests/unit/creditStore.test.mjs per
//     l'anti-doppio-premio.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://board/board.html';

// Un fix pulito, chiuso e già rilasciato → DEVE comparire in bacheca.
const SHIPPED = {
  _id: 'fb-shipped',
  name: 'Migliorata la cattura schermo',
  text: 'TESTO-GREZZO-NON-DEVE-COMPARIRE-IN-BACHECA',
  status: 'done',
  priority: 3,
  resolvedInVersion: '0.2.70',
  seq: 42, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-20T10:00:00Z',
  votes: { 'altro@x.com': { vote: 'works', at: '2026-06-21T10:00:00Z', credibilitySnapshot: 1 } },
};

// Un feedback classificato "attack" dal pipeline, anche se done+spedito → NON
// deve MAI comparire in bacheca, né il suo testo né i verdetti dei giudici.
const ATTACK = {
  _id: 'fb-attack',
  name: 'TITOLO-ATTACCO-SEGRETO',
  text: 'TESTO-ATTACCO-SEGRETO',
  status: 'done',
  priority: 3,
  resolvedInVersion: '0.2.70',
  seq: 43, subSeq: 0,
  createdAt: '2026-06-20T11:00:00Z',
  pipeline: {
    action: 'block_attack', l2Class: 'attack', stage: 'L2',
    verdicts: [{ judge: 'A', class: 'attack', reasoning: 'VERDETTO-SEGRETO-DEI-GIUDICI' }],
    filoSummary: 'SOMMARIO-SICUREZZA-SEGRETO',
  },
};

// Un fix ancora in coda (todo) → NON in bacheca (non è in produzione).
const TODO = {
  _id: 'fb-todo', name: 'Fix non ancora pronto', status: 'todo',
  seq: 44, subSeq: 0, createdAt: '2026-06-22T10:00:00Z',
};

async function seed(page, { signedIn } = {}) {
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW);
  // Aspetta che il caricamento live (FB.list verso Firestore) si sia stabilizzato
  // prima di iniettare i dati di test: così setData è SEMPRE l'ultimo render e i
  // dati finti non vengono clobberati dalla load reale che parte all'init.
  await page.locator('#bdLoading').waitFor({ state: 'hidden' });
  await page.evaluate(({ list, email }) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    if (email) window.__boardTest.setSignedIn(email);
    window.__boardTest.setData(list);
  }, { list: [SHIPPED, ATTACK, TODO], email: signedIn || null });
}

test('mostra solo i fix in produzione come schede votabili (titolo + pulsanti)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page);

  // Esattamente una scheda: il fix pulito spedito. Attack e todo esclusi.
  await expect(page.locator('.bd-card')).toHaveCount(1);
  await expect(page.locator('.bd-card-title')).toHaveText('Migliorata la cattura schermo');
  await expect(page.locator('#bdEmpty')).toBeHidden();

  // È VOTABILE: due pulsanti funziona/non-funziona, col conteggio esistente.
  await expect(page.locator('.bd-card .bd-vote-works')).toHaveCount(1);
  await expect(page.locator('.bd-card .bd-vote-broken')).toHaveCount(1);
  await expect(page.locator('.bd-card .bd-vote-works .bd-vote-count')).toHaveText('1');
});

test('ZERO info di sicurezza: attack escluso, suoi testi/verdetti assenti dal DOM', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page);

  const body = await page.locator('body').innerText();
  // Niente materiale red-team, né del fix mostrato né del feedback bloccato.
  for (const secret of [
    'TITOLO-ATTACCO-SEGRETO', 'TESTO-ATTACCO-SEGRETO', 'VERDETTO-SEGRETO-DEI-GIUDICI',
    'SOMMARIO-SICUREZZA-SEGRETO', 'TESTO-GREZZO-NON-DEVE-COMPARIRE-IN-BACHECA',
  ]) {
    expect(body).not.toContain(secret);
  }
  // Nessuna etichetta di stato/priorità/giudizio in pagina.
  for (const word of ['attack', 'block', 'priorità', 'Giudice', 'verdetto', 'todo', 'done']) {
    expect(body.toLowerCase()).not.toContain(word.toLowerCase());
  }
});

test('anonimo: invito ad accedere; loggato (lato renderer): il voto passa dal main', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Anonimo: pulsante Accedi visibile.
  await seed(page, {});
  await expect(page.locator('#bdSignIn')).toBeVisible();

  // Loggato lato renderer (hook di test): niente pulsante Accedi.
  await seed(page, { signedIn: 'me@example.com' });
  await expect(page.locator('#bdSignIn')).toBeHidden();

  // Il voto reale (DC2) passa SEMPRE dall'IPC BOARD_CAST_VOTE — il main, non il
  // renderer, scrive su Firestore con l'idToken e accredita i crediti. In questo
  // ambiente di test non esiste una sessione reale lato main (il login Google
  // dal vivo non è simulabile da Playwright — vedi auth-pkce.spec.mjs), quindi
  // l'IPC torna ok:false ("Accedi per votare..."): l'aggiornamento ottimistico
  // locale viene mostrato e poi RIPRISTINATO con garbo, senza crash né stato
  // sporco. Questo è il comportamento corretto e verificabile qui; il flusso
  // end-to-end con un account reale è verificato dall'unit test della
  // ricompensa (creditStore) + dalla code review della scrittura idToken.
  //
  // Lo stato "in volo" dura quanto il round-trip IPC: qualche millisecondo, meno
  // di quanto serva a guardarlo. Qui teniamo la risposta sospesa finché non la
  // rilasciamo noi, così "disabilitato mentre invia" e "ripristinato dopo" sono
  // due momenti DISTINTI e osservabili invece di una corsa persa in partenza.
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.__voteCalls = 0;
    window.__releaseVote = null;
    window.filo.message = (msg) => {
      if (msg && (msg.type === 'board_cast_vote' || msg.type === 'board_clear_vote')) {
        window.__voteCalls += 1;
        return new Promise((resolve) => { window.__releaseVote = resolve; });
      }
      return orig(msg);
    };
  });

  const works = page.locator('.bd-card .bd-vote-works');
  await expect(works).toHaveAttribute('aria-pressed', 'false');
  await expect(works.locator('.bd-vote-count')).toHaveText('1');

  await works.click();
  // Riscontro immediato: il conteggio sale subito (aggiornamento ottimistico).
  await expect(works.locator('.bd-vote-count')).toHaveText('2');
  // Mentre la richiesta è in volo il pulsante è disabilitato (anti doppio-click)…
  await expect(works).toBeDisabled();
  // …e insistere non fa partire una seconda richiesta.
  await works.click({ force: true }).catch(() => {});
  expect(await page.evaluate(() => window.__voteCalls)).toBe(1);

  // Risposta negativa dal main (in questo ambiente non esiste una sessione
  // reale): il voto torna indietro E la bacheca DICE perché — niente voto
  // fantasma, niente conteggio che si sgonfia in silenzio.
  await page.evaluate(() => window.__releaseVote({ ok: false, error: 'Accedi per votare i miglioramenti.' }));
  await expect(works).toBeEnabled();
  await expect(works).toHaveAttribute('aria-pressed', 'false');
  await expect(works.locator('.bd-vote-count')).toHaveText('1');
  await expect(page.locator('.bd-card .bd-vote-msg').first())
    .toHaveText('Accedi per votare i miglioramenti.');
  // Traccia ispezionabile del messaggio in pagina (cartella gitignorata).
  await page.screenshot({ path: 'tests/.shots/board-vote-error.png' }).catch(() => {});

  // Un nuovo tentativo azzera la spiegazione precedente (non resta appiccicata).
  await works.click();
  await expect(page.locator('.bd-vote-msg')).toHaveCount(0);
  await page.evaluate(() => window.__releaseVote({ ok: false }));
  await expect(page.locator('.bd-card .bd-vote-msg').first())
    .toHaveText('Voto non registrato: riprova fra un momento.');
});
