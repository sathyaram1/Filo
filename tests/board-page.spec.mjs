// Spec Playwright per la bacheca utente (filo://board/, DC1).
//
// Assert di COMPORTAMENTO (asserisce il SUCCESSO della feature, non l'assenza
// di un errore):
//   - un non-owner apre la bacheca e VEDE i fix in produzione (done/verified +
//     spediti) come schede VOTABILI (titolo sicuro + pulsanti funziona/non-funziona);
//   - NON vede nulla del red-team: niente stato, priorità, verdetti dei giudici,
//     testo del feedback bloccato, mittente, pipeline. Un feedback "attack" anche
//     se chiuso NON compare e il suo testo/verdetti non sono nel DOM;
//   - anonimo → invito ad accedere; loggato → può esprimere un voto (toggle locale).

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

test('anonimo: invito ad accedere; loggato: può votare (toggle locale)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Anonimo: pulsante Accedi visibile.
  await seed(page, {});
  await expect(page.locator('#bdSignIn')).toBeVisible();

  // Loggato: niente pulsante Accedi; un voto si registra localmente (aria-pressed).
  await seed(page, { signedIn: 'me@example.com' });
  await expect(page.locator('#bdSignIn')).toBeHidden();

  const works = page.locator('.bd-card .bd-vote-works');
  await expect(works).toHaveAttribute('aria-pressed', 'false');
  await expect(works.locator('.bd-vote-count')).toHaveText('1');
  await works.click();
  await expect(works).toHaveAttribute('aria-pressed', 'true');
  await expect(works.locator('.bd-vote-count')).toHaveText('2'); // il mio voto si aggiunge
  // Ri-cliccare annulla (toggle).
  await works.click();
  await expect(works).toHaveAttribute('aria-pressed', 'false');
  await expect(works.locator('.bd-vote-count')).toHaveText('1');
});
