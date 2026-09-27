// #678.1 — la bacheca dice com'è andata quando tocchi qualcosa. Un voto che
// non passa lo scrive sulla scheda (rete, sessione, fix tornato in
// lavorazione) invece di far tornare il conteggio indietro in silenzio; una
// riapertura riuscita lascia la scheda in lista con la conferma e i crediti
// spesi, invece di farla sparire (o di lasciare «Nessun miglioramento…»).
// Il main è sostituito in pagina: qui si prova quello che vede l'utente.

import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL = 'filo://board/board.html';
const SHOTS = path.join(process.cwd(), 'tests', '.shots');

const FIX = {
  _id: 'fb-esito',
  name: 'Il pulsante Condividi non risponde',
  status: 'done',
  resolvedInVersion: '0.2.70',
  seq: 91, subSeq: 0,
  createdAt: '2026-06-20T10:00:00Z',
  votes: { altro: { vote: 'works', at: '2026-06-21T10:00:00Z', credibilitySnapshot: 1 } },
};

// `risposte[type]` è la sequenza di risposte del main finto per quel tipo.
async function apri(openTab, risposte) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.evaluate((ris) => {
    window.__chiamate = [];
    const vero = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const coda = msg && ris[msg.type];
      if (coda) {
        window.__chiamate.push(msg.type);
        return coda.length > 1 ? coda.shift() : coda[0];
      }
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: window.__signedIn !== false, uid: 'chi-vota' };
      return vero(msg);
    };
  }, risposte);
  await page.evaluate((fix) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setSignedIn('chi-vota');
    window.__boardTest.setData([fix]);
  }, FIX);
  const card = page.locator('.bd-card').first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  return { page, card };
}

async function scatta(page, nome) {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.screenshot({ path: path.join(SHOTS, `board-esito-${nome}-${tema}.png`) });
  }
}

test('voto senza rete: il conteggio torna com\'era e la scheda dice perché', async ({ openTab }) => {
  const { page, card } = await apri(openTab, {
    board_cast_vote: [{ ok: false, code: 'offline', error: 'Non riesco a raggiungere il server: controlla la connessione e riprova.' }],
  });
  await card.locator('.bd-vote-works').click();
  const msg = card.locator('.bd-card-msg');
  await expect(msg).toHaveText(/controlla la connessione/, { timeout: 10_000 });
  await expect(card.locator('.bd-vote-works .bd-vote-count')).toHaveText('1');
  await expect(card.locator('.bd-vote-works')).toHaveAttribute('aria-pressed', 'false');
  await scatta(page, 'voto-offline');

  // Un ridisegno (dati che arrivano) non porta via la spiegazione.
  await page.evaluate((fix) => window.__boardTest.setData([fix]), FIX);
  await expect(page.locator('.bd-card').first().locator('.bd-card-msg')).toBeVisible();
});

test('rivotare dopo un errore toglie l\'avviso e, se passa, il voto resta', async ({ openTab }) => {
  const { card } = await apri(openTab, {
    board_cast_vote: [
      { ok: false, code: 'offline', error: 'Non riesco a raggiungere il server: controlla la connessione e riprova.' },
      { ok: true, uid: 'chi-vota', votes: { ...FIX.votes, 'chi-vota': { vote: 'works', at: 'x', credibilitySnapshot: 1 } } },
    ],
  });
  await card.locator('.bd-vote-works').click();
  await expect(card.locator('.bd-card-msg')).toBeVisible({ timeout: 10_000 });
  const again = card.locator('.bd-vote-works');
  await again.click();
  await expect(card.locator('.bd-vote-works .bd-vote-count')).toHaveText('2', { timeout: 10_000 });
  await expect(card.locator('.bd-card-msg')).toHaveCount(0);
});

test('un errore del main senza frase (eccezione) non resta muto', async ({ openTab }) => {
  const { card } = await apri(openTab, { board_cast_vote: [{ ok: false }] });
  await card.locator('.bd-vote-broken').click();
  await expect(card.locator('.bd-card-msg')).toHaveText(/voto non è stato registrato/i, { timeout: 10_000 });
});

test('voto su un fix tornato in lavorazione: la scheda lo dice e non offre più voto né riapertura', async ({ openTab }) => {
  const { page, card } = await apri(openTab, {
    board_cast_vote: [{ ok: false, code: 'gone', error: 'Questo miglioramento è tornato in lavorazione: per ora non si può più votare né segnalare.' }],
  });
  await card.locator('.bd-vote-works').click();
  await expect(card.locator('.bd-card-msg')).toHaveText(/tornato in lavorazione/, { timeout: 10_000 });
  await expect(card.locator('.bd-vote-btn')).toHaveCount(0);
  await expect(card.locator('.bd-reopen-link')).toHaveCount(0);
  await scatta(page, 'voto-ritirato');
});

test('voto con la sessione scaduta: lo dice e la barra in alto torna a offrire l\'accesso', async ({ openTab }) => {
  const { page, card } = await apri(openTab, {
    board_cast_vote: [{ ok: false, code: 'auth', error: 'Sessione scaduta: rifai l\'accesso.' }],
  });
  await page.evaluate(() => { window.__signedIn = false; });
  await card.locator('.bd-vote-works').click();
  await expect(card.locator('.bd-card-msg')).toHaveText(/Sessione scaduta/, { timeout: 10_000 });
  await expect(page.locator('#bdSignIn')).toBeVisible();
});

test('riapertura riuscita: la scheda resta con la conferma e i crediti spesi, niente «Nessun miglioramento»', async ({ openTab }) => {
  const { page, card } = await apri(openTab, {
    board_reopen: [{ ok: true, feedbackId: 'fb-figlio', balance: 70 }],
  });
  await card.locator('.bd-reopen-link').click();
  await card.locator('.bd-reopen-text').fill('Premo Condividi e non succede niente.');
  await card.locator('.bd-reopen-actions button', { hasText: 'Invia' }).click();

  const ok = card.locator('.bd-reopen-ok');
  await expect(ok).toContainText('Segnalazione inviata', { timeout: 10_000 });
  await expect(ok).toContainText('te ne restano 70');
  const costo = await page.evaluate(() => window.SN_CONST.CREDIT.BOARD_REOPEN);
  await expect(ok).toContainText(`Hai speso ${costo} crediti`);
  await expect(page.locator('#bdEmpty')).toBeHidden();
  await expect(card.locator('.bd-reopen-form')).toHaveCount(0);
  await scatta(page, 'riapertura-ok');

  // Un voto dopo (che ridisegna tutto) non la fa sparire.
  await page.evaluate(() => {
    const fix = window.__boardTest && document.querySelector('.bd-card');
    return fix;
  });
  await page.evaluate(() => window.__boardTest.setSignedIn('chi-vota'));
  await expect(page.locator('.bd-card').first().locator('.bd-reopen-ok')).toBeVisible();
});

test('riapertura di un fix tornato in lavorazione: la frase sta sulla scheda, il form sparisce', async ({ openTab }) => {
  const { card } = await apri(openTab, {
    board_reopen: [{ ok: false, code: 'gone', error: 'Questo miglioramento è tornato in lavorazione: per ora non si può più votare né segnalare.' }],
  });
  await card.locator('.bd-reopen-link').click();
  await card.locator('.bd-reopen-text').fill('Ancora rotto.');
  await card.locator('.bd-reopen-actions button', { hasText: 'Invia' }).click();
  await expect(card.locator('.bd-card-msg')).toHaveText(/tornato in lavorazione/, { timeout: 10_000 });
  await expect(card.locator('.bd-reopen-form')).toHaveCount(0);
});
