// #1076 — «Ancora rotto?» paga col portafoglio, e la riapertura la fa il server. Il cammino vero: la bacheca chiede
// al main, il main chiama la funzione `bachecaRiapri` con l'identità dell'installazione, la conferma dice spesa e
// saldo veri; senza portafoglio la scheda lo dice prima che si scriva una riga; la spesa compare fra i movimenti.
// Server e identità anonima simulati da un HTTP locale (come wallet-credits.spec.mjs); l'accesso Google è patchato.

import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/electron.mjs';

const SHOTS = path.join(process.cwd(), 'tests', '.shots');
let server;
let riaperture = [];
let rispostaRiapri = null;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      const auth = req.headers.authorization || '';
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (auth !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/bachecaRiapri') {
        riaperture.push(body.data);
        return json(res, 200, { result: rispostaRiapri || { ok: true, feedbackId: 'fb-figlio', num: '#1201', cost: 5, balance: 4995.3 } });
      }
      if (url === '/walletState') {
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 4995.3, creditsGranted: 4995, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100,
            grants: [
              { at: '2026-10-21T09:00:00.000Z', credits: -5, why: 'board_reopen:fb-rotto' },
              { at: '2026-10-08T10:00:00.000Z', credits: 5000, why: 'entry' },
            ],
            invites: [],
          },
        });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => { riaperture = []; rispostaRiapri = null; });

const FIX = {
  _id: 'fb-rotto',
  name: 'Il pulsante Condividi non risponde',
  status: 'done',
  resolvedInVersion: '0.2.70',
  seq: 91, subSeq: 0,
  createdAt: '2026-06-20T10:00:00Z',
  votes: {},
};

// Un utente qualunque con l'accesso Google (non l'owner), e la scheda pubblica come la legge il main.
async function utente(app, { portafoglio }) {
  await app.evaluate((_e, { portafoglio, fix }) => {
    const M = process.getBuiltinModule('module');
    const k = Object.keys(M._cache).find((x) => /auth[\\/]google-auth\.js$/.test(x));
    const ga = M._cache[k].exports;
    ga.isAdmin = () => false;
    ga.isSignedIn = () => true;
    ga.getUid = async () => 'uid-google';
    ga.getIdToken = async () => 'token-google';
    globalThis.SN_WALLET_MAIN.haPortafoglio = () => portafoglio;
    globalThis.SN_FEEDBACK.getPublic = async () => ({ ...fix });
    globalThis.SN_MANAGE_REVIEW.canReopen = () => true;
    globalThis.__scritture = [];
    globalThis.SN_FEEDBACK.castReopenRequest = async (...a) => { globalThis.__scritture.push(['reopen', ...a]); return {}; };
    globalThis.SN_FEEDBACK.submit = async (...a) => { globalThis.__scritture.push(['submit', ...a]); return { id: 'x' }; };
  }, { portafoglio, fix: FIX });
}

async function bacheca(openTab) {
  const page = await openTab('filo://board/board.html');
  await page.waitForFunction(() => window.__boardTest && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.evaluate((fix) => {
    window.__boardTest.setReleasedVersion('0.2.71');
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
    await page.screenshot({ path: path.join(SHOTS, `bacheca-riapertura-${nome}-${tema}.png`) });
  }
}

test('col portafoglio «Ancora rotto?» va al server con l\'identità dell\'installazione, e la scheda dice spesa e saldo', async ({ app, openTab }) => {
  await utente(app, { portafoglio: true });
  const { page, card } = await bacheca(openTab);
  await card.locator('.bd-reopen-link').click();
  const testo = 'Premo Condividi e non si apre niente. <b>ancora</b> 🙂';
  await card.locator('.bd-reopen-text').fill(testo);
  await card.locator('.bd-reopen-actions button', { hasText: 'Invia' }).click();

  const ok = card.locator('.bd-reopen-ok');
  await expect(ok).toContainText('Segnalazione inviata', { timeout: 15_000 });
  await expect(ok).toContainText('Hai speso 5 crediti, te ne restano 4.995,3');
  expect(riaperture).toEqual([{ id: FIX._id, text: testo }]);
  // Il segnale e il feedback collegato li scrive il server: dal client nessuna scrittura.
  expect(await app.evaluate(() => globalThis.__scritture)).toEqual([]);
  await scatta(page, 'ok');
});

test('il server dice che il saldo non basta: la frase coi numeri, e il testo resta per riprovare', async ({ app, openTab }) => {
  rispostaRiapri = { ok: false, reason: 'insufficient', cost: 5, balance: 2.5 };
  await utente(app, { portafoglio: true });
  const { card } = await bacheca(openTab);
  await card.locator('.bd-reopen-link').click();
  await card.locator('.bd-reopen-text').fill('Ancora rotto.');
  await card.locator('.bd-reopen-actions button', { hasText: 'Invia' }).click();
  await expect(card.locator('.bd-reopen-err')).toHaveText('Servono 5 crediti per riaprire un fix (saldo: 2,5).', { timeout: 15_000 });
  await expect(card.locator('.bd-reopen-text')).toHaveValue('Ancora rotto.');
});

test('senza portafoglio la scheda lo dice al clic, prima di far scrivere, e non parte niente', async ({ app, openTab }) => {
  await utente(app, { portafoglio: false });
  const { page, card } = await bacheca(openTab);
  // La riga in cima non invita a votare chi non può.
  await expect(page.locator('#bdAuthMsg')).toContainText('servono i crediti di Filo', { timeout: 10_000 });
  await card.locator('.bd-reopen-link').click();
  await expect(card.locator('.bd-card-msg')).toContainText('servono i crediti di Filo', { timeout: 10_000 });
  await expect(card.locator('.bd-card-msg')).toContainText('riscatta un invito nella pagina Crediti');
  await expect(card.locator('.bd-reopen-form')).toBeHidden();
  // Anche il voto: la frase sulla scheda, nessuna scrittura.
  await card.locator('.bd-vote-works').click();
  await expect(card.locator('.bd-card-msg')).toContainText('Per votare servono i crediti di Filo', { timeout: 10_000 });
  await expect(card.locator('.bd-vote-works .bd-vote-count')).toHaveText('0');
  expect(riaperture).toEqual([]);
  await scatta(page, 'senza-portafoglio');
});

test('la spesa per riaprire compare fra i movimenti della pagina Crediti, col segno meno', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  const moves = page.locator('#moves li');
  await expect(moves).toHaveCount(2, { timeout: 15_000 });
  await expect(moves.nth(0)).toContainText('Fix riaperto dalla bacheca');
  await expect(moves.nth(0).locator('.sn-credits-move-gain')).toHaveText('−5');
  await expect(moves.nth(1).locator('.sn-credits-move-gain')).toHaveText('+5.000');
  await page.locator('#movesSection').scrollIntoViewIfNeeded();
  await scatta(page, 'movimenti');
});
