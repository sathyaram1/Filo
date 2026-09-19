// Giro di verifica locale del ramo claude/link-invito — giro 5.
//
// Il codice NUDO dentro un messaggio intero, com'è quando si copia una chat
// tenendo premuto: saluto davanti, codice in mezzo, congedo dietro. È la
// porta che il quarto giro aveva trovato aperta (il saluto davanti si mangiava
// il codice) e che va ri-provata, questa volta anche con del testo DIETRO al
// codice, che è la forma vera di un messaggio.
//
// Scritto da chi verifica, non da chi ha fatto il lavoro. Server finto: un
// codice vero a usi contati non si brucia per una prova.

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { test, expect } from '../../fixtures/electron.mjs';

const require = createRequire(import.meta.url);
require('../../../src/shared/wallet.js');
const W = globalThis.SN_WALLET;

const CODICE = 'ABCDEFGH';

let server;
let visto = { redeems: [] };
let riscattato = false;

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
      if (url === '/walletState') {
        if (!riscattato) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100, invites: [{ code: 'AAAA2222', max: 3, used: 0, uses: [] }],
          },
        });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'none' } });
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        visto.redeems.push(code);
        if (code !== CODICE) return json(res, 200, { result: { status: 'invalid_code' } });
        riscattato = true;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0 } });
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

test.beforeEach(() => { visto = { redeems: [] }; riscattato = false; });

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test('il messaggio intero, saluto davanti e congedo dietro, riscatta il codice che porta', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 20000 });
  await page.fill('#inviteCode', 'Ciao Anna, ecco il codice: ABCD-EFGH fammi sapere');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20000 });
  expect(visto.redeems).toContain(CODICE);
  // Al server è arrivato il codice pulito, non il messaggio.
  expect(visto.redeems.every((c) => c === CODICE)).toBe(true);
});

test('le forme in cui un codice nudo arriva dentro un messaggio', () => {
  const forme = [
    'Ciao Anna, ecco il codice: ABCD-EFGH fammi sapere',
    'Ciao Anna, ecco: ABCD-EFGH fammi sapere',
    'Ciao Anna, il tuo codice è ABCD-EFGH, a dopo',
    'Anna ecco ABCD-EFGH subito',
    'ciao come va, ecco il codice ABCD-EFGH fammi sapere',
    'Buongiorno, le mando il codice ABCD EFGH. Saluti',
    'Ehi! codice invito ABCDEFGH — scarica Filo e incollalo',
    'Ciao, ti mando il codice di invito per Filo: abcd-efgh. Scaricalo da filo.red e incollalo.',
    'CODICE INVITO\nABCD-EFGH\nvale per tre persone',
    'ecco "ABCD-EFGH" grazie mille',
    'ecco (ABCD-EFGH) grazie mille',
    'Ciao Marco, ecco il codice: ABCD-EFGH, ci vediamo!',
    'Ciao Giulia! Il codice è ABCD-EFGH 🙂 fammi sapere se funziona',
  ];
  for (const f of forme) {
    expect(W.codeFromInput(f), `forma non riconosciuta: ${JSON.stringify(f)}`).toBe(CODICE);
  }
});

test('un messaggio senza codice resta senza codice', () => {
  for (const f of ['Ciao Anna, come stai? fammi sapere', 'ecco il codice: 1234', '   ', '']) {
    expect(W.codeFromInput(f), `da qui non doveva uscire un codice: ${JSON.stringify(f)}`).toBe(null);
  }
});
