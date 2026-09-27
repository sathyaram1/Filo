// #678.2 — un accesso partito dalla bacheca (voto, «Ancora rotto?», «Accedi»)
// dice com'è andato: mentre aspetta il browser lo dice, e se non riesce la
// frase del perché resta dove l'utente ha premuto. Il login vero non si simula
// (vedi auth-pkce.spec.mjs): qui la risposta di auth_signin la decide il test.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://board/board.html';
const RETE = 'Accesso non riuscito: manca la connessione. Riprova quando sei in rete.';

const FIX = {
  _id: 'fb-login-ko',
  name: 'Fix per accesso fallito',
  status: 'done',
  priority: 3,
  resolvedInVersion: '0.2.71',
  seq: 91, subSeq: 0,
  clientId: 'altro@example.com',
  createdAt: '2026-06-20T10:00:00Z',
  votes: {},
};

async function apri(openTab) {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
  await page.evaluate((fix) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setData([fix]);
  }, FIX);
  // Ogni auth_signin resta in sospeso finché il test non lo chiude con
  // __chiudiAccesso(esito); un esito { ok: true } fa anche il login.
  await page.evaluate(() => {
    const real = window.filo.message.bind(window.filo);
    let dentro = false;
    window.__accessi = [];
    window.__gesti = [];
    window.__chiudiAccesso = (esito, i = window.__accessi.length - 1) => {
      if (esito && esito.ok) dentro = true;
      const r = window.__accessi[i];
      if (esito instanceof Error) r.reject(esito); else r.resolve(esito);
    };
    window.filo.message = (msg) => {
      if (msg.type === 'auth_signin') {
        return new Promise((resolve, reject) => window.__accessi.push({ resolve, reject }));
      }
      if (msg.type === 'auth_status') {
        return Promise.resolve(dentro ? { signedIn: true, uid: 'io@example.com' } : { signedIn: false, uid: null });
      }
      if (msg.type === 'board_cast_vote') {
        window.__gesti.push(msg);
        return Promise.resolve({ ok: true, votes: { 'io@example.com': { vote: msg.vote, at: new Date().toISOString(), credibilitySnapshot: 1 } }, uid: 'io@example.com' });
      }
      return real(msg);
    };
  });
  return page;
}

const card = (page) => page.locator(`.bd-card[data-id="${FIX._id}"]`);

test('voto da anonimo, accesso senza rete: la scheda dice perché il voto non è partito', async ({ openTab }) => {
  const page = await apri(openTab);
  await card(page).locator('.bd-vote-works').click();

  await expect(card(page).locator('.bd-card-msg')).toHaveText(/Completa l'accesso nel browser: poi il voto parte da solo/);
  await expect(page.locator('#bdAuthMsg')).toHaveText(/Completa l'accesso nel browser/);
  await expect(page.locator('#bdAuthSpin')).toBeVisible();
  await expect(page.locator('#bdSignIn')).toHaveText('Riapri il browser');

  await page.evaluate((frase) => window.__chiudiAccesso({ ok: false, code: 'rete', error: frase }), RETE);

  const msg = card(page).locator('.bd-card-msg');
  await expect(msg).toHaveText(RETE);
  await expect(msg).not.toHaveClass(/bd-card-msg-info/);
  await expect(page.locator('#bdAuthSpin')).toBeHidden();
  await expect(page.locator('#bdSignIn')).toHaveText('Accedi');
  expect(await page.evaluate(() => window.__gesti.length)).toBe(0);
  await expect(card(page).locator('.bd-vote-works')).toBeEnabled();

  await page.screenshot({ path: 'tests/.shots/678.2-voto-senza-rete.png' });

  // Riprovando, l'accesso riesce e il voto scelto parte da solo; la frase sparisce.
  await card(page).locator('.bd-vote-works').click();
  await page.evaluate(() => window.__chiudiAccesso({ ok: true }));
  await expect.poll(() => page.evaluate(() => window.__gesti.length)).toBe(1);
  await expect(card(page).locator('.bd-card-msg')).toHaveCount(0);
  await expect(page.locator('#bdAuthMsg')).toHaveText(/Sei connesso/);
});

test('«Ancora rotto?» da anonimo, il canale dell\'accesso cade: frase sulla scheda, form chiuso', async ({ openTab }) => {
  const page = await apri(openTab);
  await card(page).locator('.bd-reopen-link').click();
  await expect(card(page).locator('.bd-card-msg')).toHaveText(/poi scrivi qui cosa non va/);
  // Mentre si aspetta il browser il form non si apre: si apre solo ad accesso fatto.
  await expect(card(page).locator('.bd-reopen-form')).toBeHidden();

  await page.evaluate(() => window.__chiudiAccesso(new Error('canale chiuso')));
  await expect(card(page).locator('.bd-card-msg')).toHaveText('Accesso non riuscito: riprova.');
  await expect(card(page).locator('.bd-reopen-form')).toBeHidden();
  await expect(card(page).locator('.bd-reopen-link')).toBeVisible();
});

test('«Accedi» in testa: un accesso annullato lo dice in testa e offre «Riprova»', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.locator('#bdSignIn').click();
  await expect(page.locator('#bdAuthMsg')).toHaveText(/Completa l'accesso nel browser/);
  await page.evaluate(() => window.__chiudiAccesso({ ok: false, code: 'annullato', error: 'Accesso annullato nel browser: riprova quando vuoi.' }));

  await expect(page.locator('#bdAuthMsg')).toHaveText('Accesso annullato nel browser: riprova quando vuoi.');
  await expect(page.locator('#bdAuthMsg')).toHaveClass(/bd-auth-ko/);
  await expect(page.locator('#bdSignIn')).toHaveText('Riprova');
  await expect(card(page).locator('.bd-card-msg')).toHaveCount(0);

  await page.locator('#bdSignIn').click();
  await page.evaluate(() => window.__chiudiAccesso({ ok: true }));
  await expect(page.locator('#bdAuthMsg')).toHaveText(/Sei connesso/);
  await expect(page.locator('#bdAuthMsg')).not.toHaveClass(/bd-auth-ko/);
});

test('browser chiuso e voto ripremuto: vale l\'ultimo accesso, il primo non scrive niente', async ({ openTab }) => {
  const page = await apri(openTab);
  await card(page).locator('.bd-vote-works').click();
  // Il primo browser è stato chiuso: l'utente ripreme, stavolta su ❌.
  await card(page).locator('.bd-vote-broken').click();
  expect(await page.evaluate(() => window.__accessi.length)).toBe(2);

  // Il main chiude il primo flusso come sostituito: la pagina non deve dirlo.
  await page.evaluate(() => window.__chiudiAccesso({ ok: false, code: 'sostituito', error: 'Accesso sostituito da quello appena richiesto.' }, 0));
  await expect(card(page).locator('.bd-card-msg')).toHaveText(/Completa l'accesso nel browser/);
  await expect(page.locator('#bdAuthSpin')).toBeVisible();

  await page.evaluate(() => window.__chiudiAccesso({ ok: true }, 1));
  await expect.poll(() => page.evaluate(() => window.__gesti.map((g) => g.vote))).toEqual(['broken']);
  await expect(card(page).locator('.bd-vote-broken')).toHaveAttribute('aria-pressed', 'true');
});

test('«Riapri il browser» in testa rilancia lo stesso accesso: il voto che aspettava parte lo stesso', async ({ openTab }) => {
  const page = await apri(openTab);
  await card(page).locator('.bd-vote-works').click();
  await page.locator('#bdSignIn').click();
  expect(await page.evaluate(() => window.__accessi.length)).toBe(2);
  await expect(card(page).locator('.bd-card-msg')).toHaveText(/poi il voto parte da solo/);

  await page.evaluate(() => window.__chiudiAccesso({ ok: false, code: 'sostituito', error: 'x' }, 0));
  await page.evaluate(() => window.__chiudiAccesso({ ok: true }, 1));
  await expect.poll(() => page.evaluate(() => window.__gesti.map((g) => g.vote))).toEqual(['works']);
});

test('aspetto: attesa e frase di errore in tema chiaro e scuro', async ({ openTab }) => {
  const page = await apri(openTab);
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await card(page).locator('.bd-vote-works').click();
    await page.screenshot({ path: `tests/.shots/678.2-attesa-${tema}.png` });
    await page.evaluate((frase) => window.__chiudiAccesso({ ok: false, code: 'rete', error: frase }), RETE);
    await expect(card(page).locator('.bd-card-msg')).toHaveText(RETE);
    await page.screenshot({ path: `tests/.shots/678.2-errore-${tema}.png` });
  }
});
