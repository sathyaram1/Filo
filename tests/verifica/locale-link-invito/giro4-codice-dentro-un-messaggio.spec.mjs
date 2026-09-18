// Giro di verifica locale del ramo claude/link-invito — giro 4.
//
// Il giro 3 ha trovato che il messaggio intero copiato da una chat non veniva
// riconosciuto quando davanti al LINK c'erano due parole di quattro lettere
// («Ciao Anna, ecco: https://filo.red/i/… fammi sapere»), ed è stato corretto
// cercando prima l'indirizzo di filo.red dentro il testo.
//
// Qui si prova l'altra metà dello stesso incollaggio: il messaggio che porta
// il CODICE NUDO invece del link. Capita perché la pagina del link, a chi
// arriva da un telefono, dice di segnarsi il codice, e perché accanto a ogni
// invito c'è un pulsante che copia il codice da solo: chi lo usa scrive un
// messaggio attorno al codice, non attorno al link.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

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

test('il codice nudo dentro una riga di messaggio si riscatta, com’è arrivato', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 20000 });
  await page.fill('#inviteCode', 'Ecco il tuo invito: ABCD-EFGH, a dopo');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20000 });
  expect(visto.redeems).toContain(CODICE);
});

// ATTESA ROSSA: riproduce un rilievo di livello 1 del quarto giro, e il
// bilancio dei livelli 1 e 0 di questo lavoro è esaurito — il rilievo viene
// messo da parte, non corretto. La prova resta come memoria del giro.
test('il saluto davanti al codice nudo non deve far sparire il codice', async ({ openTab }) => {
  test.fail(true, 'rilievo di livello 1 del quarto giro, messo da parte: bilancio esaurito');
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 20000 });
  // Due parole di quattro lettere davanti al codice: è come comincia un
  // messaggio qualunque.
  await page.fill('#inviteCode', 'Ciao Anna, ecco il codice: ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20000 });
  expect(visto.redeems).toContain(CODICE);
});
