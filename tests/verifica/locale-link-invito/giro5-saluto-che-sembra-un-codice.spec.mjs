// Giro di verifica locale del ramo claude/link-invito — giro 5.
//
// Resto della porta che il quarto giro aveva aperto a metà. Adesso, quando il
// primo blocco di otto caratteri non è un codice valido, Filo continua a
// cercare lungo la riga: «Ciao Anna, ecco il codice: ABCD-EFGH» passa, perché
// «CiaoAnna» ha dentro lettere che un codice non può avere.
//
// Ma quando il saluto è fatto di lettere che un codice PUÒ avere — «Cara
// Sara», «Sera Anna», «Bene Anna» — quelle otto lettere sono un codice
// sintatticamente buono: Filo si ferma lì, manda al server il saluto e si
// sente rispondere che non vale. L'utente ha incollato un messaggio giusto e
// non entra.
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

test('un saluto fatto di lettere da codice non deve mangiarsi il codice che segue', () => {
  const messaggi = [
    'Cara Sara, ecco il codice: ABCD-EFGH',
    'Sera Anna, ecco il codice: ABCD-EFGH fammi sapere',
    'Bene Anna, ti mando il codice ABCD-EFGH',
  ];
  for (const m of messaggi) {
    expect(W.codeFromInput(m), `messaggio non letto: ${JSON.stringify(m)}`).toBe(CODICE);
  }
});

test('«Cara Sara, ecco il codice: …» deve riscattare, non essere rifiutato', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 20000 });
  await page.fill('#inviteCode', 'Cara Sara, ecco il codice: ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20000 });
  expect(visto.redeems).toContain(CODICE);
});
