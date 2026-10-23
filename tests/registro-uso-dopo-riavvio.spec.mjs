// I consumi che il server ha rifiutato restano detti nella pagina Crediti anche dopo una chiusura di Filo (#1601):
// lo scarto avviene di solito appena dopo l'avvio. Il finto server è quello di tests/ripiego-crediti.spec.mjs, ridotto al registro d'uso.

import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { test, expect, chiudiApp } from './fixtures/electron.mjs';
import { argomentiScala } from './helpers/scala.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PERSONAL_KEY = 'sk-or-v1-test-personal';
const PSEUDONYM = 'abcdef0123456789';
const AZIONE_RIFIUTATA = 'RIFIUTATA_DAL_SERVER';

let server;
let base = '';
let redeemed = false;
const seen = { commits: [], rifiutati: 0 };

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
          seen.rifiutati += 1;
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

const redirect = (app) => app.evaluate((_, b) => {
  if (globalThis.__filoFetchVero) return;
  const vero = globalThis.fetch;
  globalThis.__filoFetchVero = vero;
  globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
}, base);

test('un consumo rifiutato dal server resta detto in Crediti dopo aver chiuso e riaperto Filo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const credits = await openTab('filo://credits/credits.html');
  await expect(credits.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await credits.fill('#inviteCode', 'abcd-efgh');
  await credits.click('#redeemBtn');
  await expect(credits.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
  await redirect(app);
  await app.evaluate(async (_, [p, a]) => {
    const W = globalThis.SN_WALLET;
    const riga = (action) => W.usageRow({ pseudonym: p, action, model: 'deepseek-flash', servedBy: 'Fake', usage: { promptTokens: 3, completionTokens: 2 }, costUsd: 0.0001, credits: 0.2 });
    await globalThis.SN_STORAGE.setRaw('walletUsageQueue', [riga('BUONA'), riga(a)]);
    await globalThis.SN_WALLET_MAIN.rileggiCodaPerTest();
    await globalThis.SN_WALLET_MAIN.flush();
  }, [PSEUDONYM, AZIONE_RIFIUTATA]);
  await expect.poll(() => seen.commits.length, { timeout: 20_000 }).toBe(1);
  const frase = 'Un consumo non è stato registrato: rifiutato dal server.';
  await credits.reload();
  await expect(credits.locator('#usageLogNote')).toHaveText(frase, { timeout: 15_000 });

  // Chiusa e riaperta sulla stessa cartella dei dati: il consumo perso non deve sparire dal racconto.
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await chiudiApp(app);
  const app2 = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
  });
  try {
    const shell = await primaFinestra(app2);
    await redirect(app2);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), 'filo://credits/credits.html');
    await expect.poll(() => app2.windows().some((w) => w.url().startsWith('filo://credits/')), { timeout: 15000 }).toBe(true);
    const page = app2.windows().find((w) => w.url().startsWith('filo://credits/'));
    await expect(page.locator('#pseudonym')).toHaveText(PSEUDONYM, { timeout: 15000 });
    await expect(page.locator('#usageLogNote')).toHaveText(frase, { timeout: 15_000 });
  } finally {
    await chiudiApp(app2);
  }
});
