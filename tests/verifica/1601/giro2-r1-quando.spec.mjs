// Verifica #1601, giro 2, rilievo 1: la nota dei consumi non registrati deve dire quando è successo, così chi
// l'ha curata (chiave nuova, consumi che arrivano di nuovo) non la legge come un guasto ancora in corso.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const PERSONAL_KEY = 'sk-or-v1-test-personal';
const PSEUDONYM = 'abcdef0123456789';
const AZIONE_RIFIUTATA = 'RIFIUTATA_DAL_SERVER';

let server;
let base = '';
let redeemed = false;
const seen = { commits: [] };

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
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: PSEUDONYM, balance: { credits: 4990, creditsGranted: 5000, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletRedeem') {
        redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: PERSONAL_KEY, pseudonym: PSEUDONYM, credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } });
      }
      if (url.startsWith('/v1/projects/') && url.endsWith(':commit')) {
        const writes = body.writes || [];
        if (writes.some((w) => w.update.fields.action?.stringValue === AZIONE_RIFIUTATA)) {
          return json(res, 403, { error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } });
        }
        seen.commits.push(writes);
        return json(res, 200, { writeResults: writes.map(() => ({})) });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
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

test('r1 la nota dei consumi non registrati dice quando è successo, anche quando i consumi dopo arrivano', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const credits = await openTab('filo://credits/credits.html');
  await expect(credits.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await credits.fill('#inviteCode', 'abcd-efgh');
  await credits.click('#redeemBtn');
  await expect(credits.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
  await app.evaluate((_, b) => {
    const vero = globalThis.fetch;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
  }, base);
  await app.evaluate(async (_, [p, a]) => {
    const W = globalThis.SN_WALLET;
    const riga = (action) => W.usageRow({ pseudonym: p, action, model: 'deepseek-flash', servedBy: 'Fake', usage: { promptTokens: 3, completionTokens: 2 }, costUsd: 0.0001, credits: 0.2 });
    await globalThis.SN_STORAGE.setRaw('walletUsageQueue', [riga(a)]);
    await globalThis.SN_WALLET_MAIN.rileggiCodaPerTest();
    await globalThis.SN_WALLET_MAIN.flush();
  }, [PSEUDONYM, AZIONE_RIFIUTATA]);
  await expect.poll(() => app.evaluate(() => globalThis.SN_WALLET_MAIN.usageLogStatus().discarded), { timeout: 15_000 }).toBe(1);

  // Poi i consumi tornano ad arrivare: il registro funziona di nuovo.
  await app.evaluate(async () => {
    for (const a of ['DOPO_1', 'DOPO_2']) {
      await globalThis.SN_WALLET_MAIN.recordUsage({ action: a, model: 'deepseek-flash', servedBy: 'Fake', usage: { keySource: 'personal', promptTokens: 4, completionTokens: 1, costUsd: 0.0002 } });
    }
    await globalThis.SN_WALLET_MAIN.flush();
  });
  await expect.poll(() => seen.commits.flat().length, { timeout: 15_000 }).toBe(2);

  await credits.reload();
  const nota = credits.locator('#usageLogNote');
  await expect(nota).toBeVisible({ timeout: 15_000 });
  // SUCCESSO: la nota dice quando (oggi, ieri, una data o un'ora), non solo quanti.
  await expect(nota).toHaveText(/\boggi\b|\bieri\b|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2} (gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/i);
});
