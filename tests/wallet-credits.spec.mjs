// Crediti sul server e chiave personale (#598): la pagina Crediti riscatta un
// invito, mostra il saldo che dice il SERVER e i codici da dare.
//
// Server e identità Firebase sono simulati da un HTTP locale: gli endpoint si
// spostano con FILO_FUNCTIONS_BASE (le funzioni wallet*) e con
// FILO_IDENTITY_ENDPOINT / FILO_SECURE_TOKEN_ENDPOINT (l'account anonimo).
// Le variabili vanno nell'ambiente PRIMA che la fixture lanci Electron: per
// questo il finto server parte in beforeAll e le scrive in process.env.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

let server;
const seen = { redeems: [], states: 0, signups: 0, tokens: [] };
let redeemed = false;

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

      // Identità anonima: signUp senza email → uid + token.
      if (url === '/accounts:signUp') {
        seen.signups += 1;
        return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      }
      if (url === '/token') {
        return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      }

      // Le funzioni wallet* vogliono il token dell'installazione.
      if (auth !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      seen.tokens.push(auth);

      if (url === '/walletState') {
        seen.states += 1;
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.0084, remainingUsd: 4.1916, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100,
            invites: [
              { code: 'AAAA-2222', used: false, usedAt: null },
              { code: 'BBBB-3333', used: true, usedAt: '2026-09-08T10:00:00.000Z' },
              { code: 'CCCC-4444', used: false, usedAt: null },
            ],
          },
        });
      }
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        seen.redeems.push(code);
        if (code.replace(/[^A-Z0-9]/gi, '').toUpperCase() !== 'ABCDEFGH') {
          return json(res, 200, { result: { status: 'invalid_code' } });
        }
        redeemed = true;
        return json(res, 200, {
          result: {
            status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000,
            inviteCodes: ['AAAA-2222', 'BBBB-3333', 'CCCC-4444'],
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

test('senza portafoglio la pagina chiede l\'invito; col codice giusto mostra il saldo del server e i codici da dare', async ({ app, openTab }) => {
  const page = await openTab('filo://credits/credits.html');

  // Il campo c'è, in cima. Senza nessuna chiave il conteggio locale non
  // compra niente: niente saldo finto, niente «+100 a mezzanotte», niente
  // invito al login.
  const form = page.locator('#redeemForm');
  await expect(form).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#invitesSection')).toBeHidden();
  await expect(page.locator('#hero')).toBeHidden();
  await expect(page.locator('#refillHint')).toBeHidden();
  await expect(page.locator('#offlineHint')).toBeHidden();
  await expect(page.locator('#ownerSection')).toBeHidden();
  const formBox = await form.boundingBox();
  expect(formBox.y).toBeLessThan(200);
  expect(seen.signups).toBeGreaterThan(0); // l'identità dell'installazione è nata

  // Codice sbagliato: frase chiara, si resta lì.
  await page.fill('#inviteCode', 'ZZZZ-9999');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('non esiste');

  // Codice giusto, scritto in minuscolo col trattino: il server lo normalizza.
  await page.fill('#inviteCode', 'abcd-efgh');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });

  // Il saldo grande è quello del SERVER, non più il conteggio locale.
  await expect(page.locator('#hero')).toBeVisible();
  await expect(page.locator('#balance')).toHaveText('4.990');
  await expect(page.locator('#refillHint')).toContainText('+100');
  await expect(form).toBeHidden();

  // I tre codici, con quello usato barrato e non copiabile.
  const invites = page.locator('#invites li');
  await expect(invites).toHaveCount(3);
  await expect(invites.nth(1)).toHaveClass(/is-used/);
  await expect(invites.nth(1).locator('.sn-wallet-code')).toBeDisabled();
  await expect(invites.nth(0).locator('.sn-wallet-code')).toHaveText('AAAA-2222');

  // La chiave personale è arrivata al main e da lì entra nelle chiamate ai
  // modelli: con «usa modelli predefiniti» attivo e nessuna chiave propria,
  // la chiave effettiva è quella personale.
  const source = await app.evaluate(() => globalThis.SN_WALLET_MAIN.keySource());
  expect(source).toBe('personal');
  expect(seen.redeems).toEqual(['ZZZZ-9999', 'abcd-efgh']);
});
