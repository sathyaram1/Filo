// Spec Playwright: la bacheca non deve perdere l'intenzione dell'utente quando
// il voto o "Ancora rotto?" partono da anonimo.
//
// Prima del fix: cliccare "Funziona"/"Non funziona" o "Ancora rotto?" da
// anonimo avviava solo il login (auth_signin) e poi ridisegnava la lista,
// SENZA eseguire l'azione originale — l'utente doveva ricliccare una seconda
// volta a login avvenuto. Qui simuliamo un login riuscito (senza rete/Google
// reali, non simulabili in Playwright — vedi auth-pkce.spec.mjs) e verifichiamo
// che l'azione scelta prima del login venga eseguita DA SOLA subito dopo,
// asserendo il SUCCESSO (il voto arriva, il form si apre) non solo l'assenza
// di crash.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://board/board.html';

const SHIPPED = {
  _id: 'fb-resume',
  name: 'Fix di test per resume post-login',
  status: 'done',
  priority: 3,
  resolvedInVersion: '0.2.71',
  seq: 77, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-20T10:00:00Z',
  votes: {},
};

async function seedBoard(page, { items = [], signedIn = null, version = '0.2.71' } = {}) {
  await page.waitForFunction(
    () => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW,
    null,
    { timeout: 15_000 },
  );
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
  await page.evaluate(({ list, email, ver }) => {
    window.__boardTest.setReleasedVersion(ver);
    if (email) window.__boardTest.setSignedIn(email);
    window.__boardTest.setData(list);
  }, { list: items, email: signedIn, ver: version });
}

// Rimpiazza window.filo.message con uno stub che:
//  - su auth_signin: simula un login riuscito impostando lo stato "signedIn"
//    tramite l'hook di test, poi risolve { ok: true }.
//  - su board_cast_vote/board_clear_vote/board_reopen: risponde con un
//    successo finto, registrando la chiamata per l'assert.
//  - su tutto il resto: passa all'IPC reale.
async function stubAuthAndCapture(page, { uid = 'tester@example.com' } = {}) {
  await page.evaluate((uidArg) => {
    const real = window.filo.message.bind(window.filo);
    window.__calls = [];
    window.filo.message = (msg) => {
      if (msg.type === 'auth_signin') {
        window.__boardTest.setSignedIn(uidArg);
        return Promise.resolve({ ok: true, profile: { email: uidArg } });
      }
      if (msg.type === 'auth_status') {
        return Promise.resolve({ signedIn: true, uid: uidArg });
      }
      if (msg.type === 'board_cast_vote' || msg.type === 'board_clear_vote') {
        window.__calls.push(msg);
        return Promise.resolve({ ok: true, votes: { [uidArg]: { vote: msg.vote || 'works', at: new Date().toISOString(), credibilitySnapshot: 1 } }, uid: uidArg, awarded: false });
      }
      if (msg.type === 'board_reopen') {
        window.__calls.push(msg);
        return Promise.resolve({ ok: true, feedbackId: 'fb-new-reopen', balance: 0 });
      }
      return real(msg);
    };
  }, uid);
}

test('votare da anonimo: dopo il login il voto scelto viene eseguito da solo, senza secondo click', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seedBoard(page, { items: [SHIPPED], signedIn: null });
  await stubAuthAndCapture(page);

  const worksBtn = page.locator('.bd-card .bd-vote-works');
  await expect(worksBtn).toBeVisible();

  await worksBtn.click();

  // Il login (stub) avviene e l'IPC di voto deve essere stato chiamato UNA
  // volta, senza bisogno di un secondo click.
  await expect.poll(async () => page.evaluate(() => window.__calls.length)).toBe(1);
  const call = await page.evaluate(() => window.__calls[0]);
  expect(call.type).toBe('board_cast_vote');
  expect(call.vote).toBe('works');
  expect(call.id).toBe('fb-resume');

  // Il tally riflette il voto arrivato (successo reale, non solo "nessun errore").
  await expect(page.locator('.bd-card .bd-vote-works .bd-vote-count')).toHaveText('1');
  await expect(page.locator('.bd-card .bd-vote-works')).toHaveAttribute('aria-pressed', 'true');
});

test('"Ancora rotto?" da anonimo: dopo il login il form si apre da solo, senza secondo click', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seedBoard(page, { items: [SHIPPED], signedIn: null });
  await stubAuthAndCapture(page);

  const link = page.locator('.bd-card .bd-reopen-link');
  await expect(link).toBeVisible();

  const form = page.locator('.bd-card .bd-reopen-form');
  await expect(form).toBeHidden();

  await link.click();

  // Dopo il login (stub), il form deve aprirsi DA SOLO: l'intenzione originale
  // (segnalare "ancora rotto") non va persa, niente secondo click sul link.
  await expect(form).toBeVisible();
  await expect(page.locator('.bd-card .bd-reopen-text')).toBeFocused();

  // L'utente può ora scrivere e inviare senza aver dovuto ricliccare il link.
  await page.locator('.bd-card .bd-reopen-text').fill('Ho riprovato e si rompe ancora dopo il login.');
  await page.locator('.bd-card .bd-reopen-actions button', { hasText: 'Invia' }).click();

  await expect.poll(async () => page.evaluate(() => window.__calls.length)).toBe(1);
  const call = await page.evaluate(() => window.__calls[0]);
  expect(call.type).toBe('board_reopen');
  expect(call.id).toBe('fb-resume');
});
