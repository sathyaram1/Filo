// Verifica #578 giro 8 (riallineamento): il giro del modello passa dal ripiego della chiave arrivato su main.
// Con la chiave propria rifiutata e la risposta servita dai crediti di Filo, il quadrato ferma lo stesso, subito;
// senza stop la risposta arriva con la riga del ripiego sotto.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const OWN_KEY = 'sk-or-v1-own-key-123456';
const PERSONAL_KEY = 'sk-or-v1-test-personal';

let server;
let base = '';
let redeemed = false;
let personalDelayMs = 0;
const chiamate = [];
let interrotte = 0;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const url = req.url.split('?')[0];
      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.0084, remainingUsd: 4.1916, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletRedeem') {
        redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: PERSONAL_KEY, pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } });
      }
      if (url === '/api/v1/chat/completions') {
        const conStrumenti = Array.isArray(body.tools) && body.tools.length > 0;
        chiamate.push({ key: bearer, tools: conStrumenti, at: Date.now() });
        if (bearer !== PERSONAL_KEY) return json(res, 401, { error: { message: 'User not found.', code: 401 } });
        res.on('close', () => { if (!res.writableEnded) interrotte += 1; });
        if (conStrumenti && personalDelayMs) await new Promise((r) => setTimeout(r, personalDelayMs));
        if (res.destroyed || req.destroyed) return;
        if (body.stream !== true) return json(res, 200, { id: 'gen-1', provider: 'Fake', choices: [{ message: { content: 'Ciao: RISPOSTA-DALLA-PERSONALE.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.00021 } });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'gen-1', provider: 'Fake', choices: [{ delta: { content: 'Ciao: RISPOSTA-DALLA-PERSONALE.' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.00021 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (url === '/api/v1/auth/key') return json(res, 200, { data: { label: 'la mia', limit: 10, usage: 1.5, limit_remaining: 8.5 } });
      if (url === '/api/v1/credits') return json(res, 200, { data: { total_credits: 25, total_usage: 5.5 } });
      if (url === '/api/v1/generation') return json(res, 404, { error: { message: 'not yet' } });
      if (url.startsWith('/v1/projects/') && url.endsWith(':commit')) return json(res, 200, { writeResults: (body.writes || []).map(() => ({})) });
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
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => { interrotte = 0; redeemed = false; personalDelayMs = 0; chiamate.length = 0; });

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function prepara(app, openTab) {
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  const crediti = await openTab('filo://credits/credits.html');
  await expect(crediti.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await crediti.fill('#inviteCode', 'abcd-efgh');
  await crediti.click('#redeemBtn');
  await expect(crediti.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
  await app.evaluate(async (_, { b, k }) => {
    if (!globalThis.__filoFetchVero) {
      const vero = globalThis.fetch;
      globalThis.__filoFetchVero = vero;
      globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/openrouter\.ai/, b).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
    }
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: k },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const M = globalThis.SN_FILO_MEMORY;
    await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
  }, { b: base, k: OWN_KEY });
  await home.bringToFront().catch(() => {});
  await home.reload();
  await expect(home.locator('#input')).toBeVisible();
  return home;
}

test('chiave propria rifiutata, risposta dai crediti di Filo lenta: il quadrato ferma subito e la risposta non arriva', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await prepara(app, openTab);
  personalDelayMs = 9000;
  await home.locator('#input').fill('scrivimi un poema');
  await home.locator('#sendBtn').click();
  // Il giro è passato dalla chiave propria (rifiutata) ed è in volo sulla personale.
  await expect.poll(() => chiamate.filter((c) => c.tools && c.key === PERSONAL_KEY).length, { timeout: 15000 }).toBeGreaterThan(0);
  expect(chiamate.some((c) => c.tools && c.key === OWN_KEY)).toBe(true);
  const ferma = home.locator('#stopBtn');
  await expect(ferma).toBeVisible();
  const t0 = Date.now();
  await ferma.click();
  const blocco = home.locator('.dash-activity');
  await expect(blocco).toHaveAttribute('data-fermato', '1', { timeout: 1_000 });
  await expect(home.locator('.dash-bubble-fermato')).toHaveText('Fermato prima della risposta.', { timeout: 4_000 });
  await expect(home.locator('#sendBtn')).toHaveAttribute('aria-label', 'Riprendi', { timeout: 4_000 });
  expect(Date.now() - t0).toBeLessThan(5_000);
  // La chiamata in volo sulla chiave personale si interrompe davvero: lo stop arriva attraverso il ripiego.
  await expect.poll(() => interrotte, { timeout: 3_000 }).toBeGreaterThan(0);
  // La chat è libera subito: un seguito parte senza aspettare la risposta lenta.
  personalDelayMs = 0;
  await home.locator('#input').fill('lascia stare, ciao');
  await home.locator('#input').press('Enter');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'RISPOSTA-DALLA-PERSONALE' })).toHaveCount(1, { timeout: 8_000 });
  await home.waitForTimeout(9_000);
  // La risposta del giro fermato non arriva mai a schermo.
  await expect(home.locator('.dash-bubble-filo', { hasText: 'RISPOSTA-DALLA-PERSONALE' })).toHaveCount(1);
});

test('senza stop, la stessa strada risponde e scrive la riga del ripiego sotto la risposta', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await prepara(app, openTab);
  await home.locator('#input').fill('ciao ripiego');
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30000 });
  await expect(home.locator('.dash-bubble-note')).toContainText('ho usato i crediti di Filo');
  await expect(home.locator('#sendBtn')).toHaveAttribute('aria-label', 'Invia');
});
