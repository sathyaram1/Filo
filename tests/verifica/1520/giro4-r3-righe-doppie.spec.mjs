// Verifica #1520 giro 4, r3: una riga d'uso arrivata al database ma senza risposta (rete caduta dopo la scrittura)
// viene riscritta col suo costo un'altra volta, e la riconciliazione segna la persona «righe in eccesso».
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const PERSONAL_KEY = 'sk-or-v1-test-personal';
const PSEUDONYM = 'abcdef0123456789';
const AZIONE = 'verifica-r3';

let server;
let base = '';
let redeemed = false;
const commits = [];
const docs = new Map();

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
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'r', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'r', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: PSEUDONYM, balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletRedeem') {
        redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: PERSONAL_KEY, pseudonym: PSEUDONYM, credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } });
      }
      // Firestore come lo fa davvero: un documento che c'è già con la condizione «non esiste» è un 409, e niente si scrive.
      if (url.startsWith('/v1/projects/') && url.endsWith(':commit')) {
        const writes = (body.writes || []).filter((w) => w.update && w.update.fields && w.update.fields.action && w.update.fields.action.stringValue === AZIONE);
        if (!writes.length) return json(res, 200, { writeResults: (body.writes || []).map(() => ({})) });
        commits.push(writes.map((w) => w.update.name));
        if (writes.some((w) => w.currentDocument && w.currentDocument.exists === false && docs.has(w.update.name))) {
          return json(res, 409, { error: { code: 409, status: 'ALREADY_EXISTS', message: 'Document already exists' } });
        }
        for (const w of writes) docs.set(w.update.name, Number(w.update.fields.costUsd.doubleValue || w.update.fields.costUsd.integerValue || 0));
        // La prima scrittura arriva, la risposta no: il portatile si è addormentato, il Wi-Fi è caduto.
        if (commits.length === 1) { req.socket.destroy(); return; }
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

test('r3 una chiamata pagata coi crediti resta una riga sola anche se la prima scrittura non ha avuto risposta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await page.fill('#inviteCode', 'abcd-efgh');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
  await app.evaluate((_, b) => {
    const vero = globalThis.fetch;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
  }, base);

  await app.evaluate(async (_, azione) => {
    await globalThis.SN_WALLET_MAIN.recordUsage({
      action: azione, model: 'deepseek/deepseek-v4-pro', servedBy: 'DeepInfra',
      usage: { keySource: 'personal', costUsd: 0.5, promptTokens: 1000, completionTokens: 200 },
    });
  }, AZIONE);
  await expect.poll(() => commits.length, { timeout: 20_000 }).toBe(1);
  // Filo riprova da sé dopo mezzo minuto: qui il nuovo tentativo si chiede subito.
  await expect.poll(async () => {
    await app.evaluate(() => globalThis.SN_WALLET_MAIN.flush());
    return commits.length;
  }, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await new Promise((r) => setTimeout(r, 1000));

  const somma = [...docs.values()].reduce((a, v) => a + v, 0);
  expect(docs.size, 'una chiamata è una riga sola nel registro d\'uso').toBe(1);
  expect(somma).toBeCloseTo(0.5, 6);
});
