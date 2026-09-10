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
const seen = { redeems: [], localCredits: [], reissues: 0, states: 0, signups: 0, tokens: [] };
let redeemed = false;
let serverDown = false;
let identityDown = false;

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
        if (identityDown) { res.destroy(); return; }
        return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      }

      // Le funzioni wallet* vogliono il token dell'installazione.
      if (serverDown) { res.destroy(); return; }
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
        seen.localCredits.push(Number(body.data && body.data.localCredits));
        if (code.replace(/[^A-Z0-9]/gi, '').toUpperCase() !== 'ABCDEFGH') {
          return json(res, 200, { result: { status: 'invalid_code' } });
        }
        redeemed = true;
        return json(res, 200, {
          result: {
            status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 6010,
            // Il conteggio locale dichiarato dall'app (1.010: benvenuto più bonus), tutto passato.
            entryCredits: 5000, migrated: 1010, localRequested: 1010, cutReason: null,
            inviteCodes: ['AAAA-2222', 'BBBB-3333', 'CCCC-4444'],
          },
        });
      }
      if (url === '/walletReissue') {
        seen.reissues += 1;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal-2', pseudonym: 'abcdef0123456789' } });
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
  await expect(page.locator('#ownerLink')).toBeHidden();
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

  // Una pagina web non legge saldo e codici né riscatta: forbidden. Da
  // filo:// la stessa chiamata passa.
  const gate = await app.evaluate(async () => {
    const web = { tab: { id: 7, url: 'http://evil.example/' }, url: 'http://evil.example/' };
    const filo = { tab: { id: 8, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' };
    const out = {};
    for (const type of ['wallet_state', 'wallet_redeem', 'wallet_reissue', 'wallet_owner_overview']) {
      out[type] = await globalThis.SN_HANDLE_MESSAGE({ type, code: 'ABCD-EFGH' }, web);
    }
    out.filoState = await globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_state' }, filo);
    return out;
  });
  for (const type of ['wallet_state', 'wallet_redeem', 'wallet_reissue', 'wallet_owner_overview']) {
    expect(gate[type], type).toEqual({ ok: false, error: 'forbidden' });
  }
  expect(gate.filoState.ok).toBe(true);
  expect(gate.filoState.server.hasWallet).toBe(true);

  // Server muto: chi ha già il portafoglio vede l'ultimo saldo letto, non il
  // campo dell'invito né il conteggio locale.
  serverDown = true;
  await page.reload();
  await expect(page.locator('#hero')).toBeVisible();
  await expect(page.locator('#balance')).toHaveText('4.990', { timeout: 15000 });
  await expect(page.locator('#redeemForm')).toBeHidden();
  await expect(page.locator('#walletNote')).toContainText('non risponde');
  await expect(page.locator('#invites li')).toHaveCount(3);
  serverDown = false;

  // Offline vero: non si rinnova nemmeno l'identità. Stessa cosa: ultimo saldo,
  // niente invito, niente «fetch failed» in pagina.
  identityDown = true;
  await app.evaluate(() => globalThis.SN_WALLET_MAIN.expireIdentityForTest());
  await page.reload();
  await expect(page.locator('#hero')).toBeVisible();
  await expect(page.locator('#balance')).toHaveText('4.990', { timeout: 15000 });
  await expect(page.locator('#redeemForm')).toBeHidden();
  await expect(page.locator('#refillHint')).not.toContainText('mezzanotte');
  await expect(page.locator('#offlineHint')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('fetch failed');
  identityDown = false;
});

test('il riscatto dice quanti crediti locali sono passati; si dichiarano una volta sola; la nuova chiave conferma', async ({ app, openTab }) => {
  redeemed = false;
  seen.redeems.length = 0; seen.localCredits.length = 0; seen.reissues = 0;
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  // La frase porta i numeri del server: ingresso e locali passati.
  await expect(page.locator('#redeemMsg')).toContainText('5.000 crediti', { timeout: 10000 });
  await expect(page.locator('#redeemMsg')).toContainText('1.010 che avevi già');
  // L'app ha dichiarato il conteggio locale (intero, positivo).
  expect(seen.localCredits).toHaveLength(1);
  expect(seen.localCredits[0]).toBeGreaterThan(0);
  expect(Number.isInteger(seen.localCredits[0])).toBe(true);

  // Un secondo riscatto dalla stessa installazione (identità nuova dopo un
  // annullamento) non ripresenta quello che è già passato.
  const again = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_redeem', code: 'ABCD-EFGH' }, { tab: { id: 9, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' }));
  expect(again.ok).toBe(true);
  expect(seen.localCredits).toHaveLength(2);
  expect(seen.localCredits[1]).toBe(0);

  // La chiave personale sparisce da questo computer (deposito perso): la
  // pagina offre «Richiedi una nuova chiave» e, premuto, CONFERMA. Nel ramo
  // -b la conferma si perdeva per una variabile della vista owner rimasta
  // nella pagina dopo il trasloco (primo giro di verifica).
  await app.evaluate(() => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    req('./auth/wallet-store').clear();
  });
  await page.reload();
  await expect(page.locator('#reissueBtn')).toBeVisible({ timeout: 15000 });
  await page.click('#reissueBtn');
  await expect(page.locator('#walletNote')).toContainText('Nuova chiave pronta', { timeout: 15000 });
  await expect(page.locator('#reissueBtn')).toBeHidden();
  expect(seen.reissues).toBe(1);
  expect(await app.evaluate(() => globalThis.SN_WALLET_MAIN.keySource())).toBe('personal');
});
