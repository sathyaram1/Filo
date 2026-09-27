// VERIFICA #678.1 giro 1 — la bacheca dice com'è andato un voto o una
// riapertura. Il canale verso il main è sostituito in pagina: si esercita la
// vera pagina con le risposte che il main dà nei casi della segnalazione.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://board/board.html';

const FIX = (id, n, votes = {}) => ({
  _id: id,
  name: `Miglioramento di prova ${n}`,
  status: 'done',
  resolvedInVersion: '0.2.70',
  seq: 900 + n, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: `2026-06-2${n}T10:00:00Z`,
  votes,
});

const ALTRI = {
  a: { vote: 'works', at: '2026-06-20T10:00:00Z', credibilitySnapshot: 1 },
  b: { vote: 'works', at: '2026-06-20T10:00:00Z', credibilitySnapshot: 1 },
  c: { vote: 'broken', at: '2026-06-20T10:00:00Z', credibilitySnapshot: 1 },
};

async function prepara(page, schede, risposte) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.evaluate((risposte) => {
    window.__risposte = risposte;
    window.__chiesti = [];
    const vero = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const r = window.__risposte[msg && msg.type];
      if (r !== undefined) {
        window.__chiesti.push(msg);
        await new Promise((ok) => setTimeout(ok, 150));
        if (r === 'THROW') throw new Error('canale caduto');
        return Array.isArray(r) ? r.shift() : r;
      }
      return vero(msg);
    };
  }, risposte);
  await page.evaluate((schede) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setSignedIn('chi-vota');
    window.__boardTest.setData(schede);
  }, schede);
}

const conteggio = (card, v) => card.locator(`.bd-vote-${v} .bd-vote-count`);

for (const [caso, risposta, frase] of [
  ['senza rete', { ok: false, code: 'offline', error: 'Non riesco a raggiungere il server: controlla la connessione e riprova.' }, /connessione/],
  ['errore generico senza frase', { ok: false }, /voto non è stato registrato/i],
  ['canale che rigetta', 'THROW', /voto non è stato registrato/i],
]) {
  test(`voto non riuscito (${caso}): il conteggio torna e la scheda dice perché`, async ({ openTab }) => {
    const page = await openTab(URL);
    await prepara(page, [FIX('fb-v1', 1, ALTRI)], { board_cast_vote: risposta });
    const card = page.locator('.bd-card').first();
    await expect(conteggio(card, 'works')).toHaveText('2');
    await card.locator('.bd-vote-works').click();
    await expect(card.locator('.bd-card-msg')).toContainText(frase, { timeout: 10_000 });
    await expect(conteggio(card, 'works')).toHaveText('2');
    await expect(card.locator('.bd-vote-works')).toHaveAttribute('aria-pressed', 'false');
    await expect(card.locator('.bd-vote-works')).toBeEnabled();
  });
}

test('voto con sessione scaduta: la scheda lo dice e ricompare «Accedi»', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [FIX('fb-v2', 2, ALTRI)], {
    board_cast_vote: { ok: false, code: 'auth', error: 'Sessione scaduta: rifai l\'accesso.' },
  });
  const card = page.locator('.bd-card').first();
  await card.locator('.bd-vote-broken').click();
  await expect(card.locator('.bd-card-msg')).toContainText('Sessione scaduta', { timeout: 10_000 });
  await expect(page.locator('#bdSignIn')).toBeVisible({ timeout: 10_000 });
  await expect(conteggio(card, 'broken')).toHaveText('1');
});

test('voto su un fix tornato in lavorazione: resta il perché, niente più voto né riapertura', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [FIX('fb-v3', 3, ALTRI)], {
    board_cast_vote: { ok: false, code: 'gone', error: 'Questo miglioramento è tornato in lavorazione: per ora non si può più votare né segnalare.' },
  });
  const card = page.locator('.bd-card').first();
  await card.locator('.bd-vote-works').click();
  await expect(card.locator('.bd-card-msg')).toContainText('tornato in lavorazione', { timeout: 10_000 });
  await expect(card.locator('.bd-vote-btn')).toHaveCount(0);
  await expect(card.locator('.bd-reopen-link')).toHaveCount(0);
});

test('un voto riuscito dopo un errore toglie la frase d\'errore', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [FIX('fb-v4', 4, ALTRI)], {
    board_cast_vote: [
      { ok: false, code: 'offline', error: 'Non riesco a raggiungere il server: controlla la connessione e riprova.' },
      { ok: true, uid: 'chi-vota', votes: { ...ALTRI, 'chi-vota': { vote: 'works', at: '2026-06-24T10:00:00Z', credibilitySnapshot: 1 } } },
    ],
  });
  const card = page.locator('.bd-card').first();
  await card.locator('.bd-vote-works').click();
  await expect(card.locator('.bd-card-msg')).toBeVisible({ timeout: 10_000 });
  await card.locator('.bd-vote-works').click();
  await expect(conteggio(card, 'works')).toHaveText('3', { timeout: 10_000 });
  await expect(card.locator('.bd-vote-works')).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.bd-card-msg')).toHaveCount(0);
});

test('riapertura riuscita con un solo fix in lista: la scheda resta con la conferma e i crediti', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [FIX('fb-r1', 5)], {
    board_reopen: { ok: true, feedbackId: 'fb-figlio', balance: 37 },
  });
  const card = page.locator('.bd-card').first();
  await card.locator('.bd-reopen-link').click();
  await card.locator('.bd-reopen-text').fill('Succede ancora 😬 <b>davvero</b>');
  const invia = card.locator('.bd-reopen-actions button', { hasText: 'Invia' });
  await invia.dblclick();
  const ok = page.locator('.bd-card .bd-reopen-ok');
  await expect(ok).toContainText('Segnalazione inviata', { timeout: 10_000 });
  await expect(ok).toContainText('37');
  await expect(page.locator('#bdEmpty')).toBeHidden();
  const n = await page.evaluate(() => window.__chiesti.filter((m) => m.type === 'board_reopen').length);
  expect(n, 'il doppio clic non manda due riaperture').toBe(1);

  // Un ridisegno da fuori (dati che si aggiornano) non la fa sparire.
  await page.evaluate(() => window.__boardTest.setData(window.__boardTest && [
    { _id: 'fb-r1', name: 'Miglioramento di prova 5', status: 'done', resolvedInVersion: '0.2.70', seq: 905, subSeq: 0,
      createdAt: '2026-06-25T10:00:00Z', votes: {}, reopenRequests: { 'chi-vota': { at: '2026-06-25T11:00:00Z' } } },
  ]));
  await expect(page.locator('.bd-card .bd-reopen-ok')).toContainText('Segnalazione inviata', { timeout: 10_000 });
  await expect(page.locator('#bdEmpty')).toBeHidden();
});

test('riapertura con crediti che non bastano: lo dice nel form, il testo resta', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [FIX('fb-r2', 6)], {
    board_reopen: { ok: false, error: 'Servono 5 crediti per riaprire un fix (saldo: 2).' },
  });
  const card = page.locator('.bd-card').first();
  await card.locator('.bd-reopen-link').click();
  await card.locator('.bd-reopen-text').fill('ancora rotto');
  await card.locator('.bd-reopen-actions button', { hasText: 'Invia' }).click();
  await expect(card.locator('.bd-reopen-err')).toContainText('Servono 5 crediti', { timeout: 10_000 });
  await expect(card.locator('.bd-reopen-text')).toHaveValue('ancora rotto');
});

test('riapertura con sessione scaduta: la frase resta sulla scheda', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [FIX('fb-r3', 7)], {
    board_reopen: { ok: false, code: 'auth', error: 'Sessione scaduta: rifai l\'accesso.' },
  });
  const card = page.locator('.bd-card').first();
  await card.locator('.bd-reopen-link').click();
  await card.locator('.bd-reopen-text').fill('ancora rotto');
  await card.locator('.bd-reopen-actions button', { hasText: 'Invia' }).click();
  await expect(page.locator('.bd-card').first()).toContainText('Sessione scaduta', { timeout: 10_000 });
});

test('aspetto: frase d\'errore, fix ritirato e conferma, in chiaro e in scuro', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [FIX('fb-s1', 1, ALTRI), FIX('fb-s2', 2, ALTRI), FIX('fb-s3', 3)], {
    board_cast_vote: [
      { ok: false, code: 'offline', error: 'Non riesco a raggiungere il server: controlla la connessione e riprova.' },
      { ok: false, code: 'gone', error: 'Questo miglioramento è tornato in lavorazione: per ora non si può più votare né segnalare.' },
    ],
    board_reopen: { ok: true, feedbackId: 'x', balance: 37 },
  });
  const cards = page.locator('.bd-card');
  // Ordine della lista: dalla più recente.
  await cards.nth(0).locator('.bd-reopen-link').click();
  await cards.nth(0).locator('.bd-reopen-text').fill('ancora rotto');
  await cards.nth(0).locator('.bd-reopen-actions button', { hasText: 'Invia' }).click();
  await expect(page.locator('.bd-reopen-ok')).toBeVisible({ timeout: 10_000 });
  await cards.nth(1).locator('.bd-vote-works').click();
  await expect(page.locator('.bd-card-msg')).toHaveCount(1, { timeout: 10_000 });
  await cards.nth(2).locator('.bd-vote-works').click();
  await expect(page.locator('.bd-card-msg')).toHaveCount(2, { timeout: 10_000 });
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.evaluate((t) => { document.documentElement.setAttribute("data-sn-theme", t); }, tema);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/verifica-678.1-${tema}.png`, fullPage: true });
  }
});

test('fix appena riaperto: come uno tornato in lavorazione, non offre più il voto', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [FIX('fb-r4', 8, ALTRI)], {
    board_reopen: { ok: true, feedbackId: 'fb-figlio', balance: 37 },
  });
  const card = page.locator('.bd-card').first();
  await card.locator('.bd-reopen-link').click();
  await card.locator('.bd-reopen-text').fill('ancora rotto');
  await card.locator('.bd-reopen-actions button', { hasText: 'Invia' }).click();
  await expect(page.locator('.bd-card .bd-reopen-ok')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.bd-card').first().locator('.bd-vote-btn')).toHaveCount(0);
});
