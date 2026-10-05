// Verifica #662, giro 1: «Trascrivi» (una zona dello schermo in testo) con la
// chiave propria rifiutata da OpenRouter: la risposta arriva coi crediti di
// Filo, e l'avviso che chiude il giro lo deve dire come la chat.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const OWN_KEY = 'sk-or-v1-own-key-662';
const PERSONAL_KEY = 'sk-or-v1-test-personal-662';
let server;
let base = '';
let redeemed = false;
const prove = [];

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
      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 't', refreshToken: 'r', expiresIn: '3600', localId: 'u1' });
      if (url === '/token') return json(res, 200, { id_token: 't', refresh_token: 'r', expires_in: '3600', user_id: 'u1' });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.0084, remainingUsd: 4.1916, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletRedeem') {
        redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: PERSONAL_KEY, pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } });
      }
      if (url === '/api/v1/chat/completions') {
        const msgs = Array.isArray(body.messages) ? body.messages : [];
        const last = JSON.stringify((msgs[msgs.length - 1] || {}).content || '');
        prove.push(bearer);
        if (bearer !== PERSONAL_KEY) return json(res, 402, { error: { message: 'no', code: 402 } });
        if (body.stream !== true) return json(res, 200, { id: 'g', choices: [{ message: { content: 'TESTO TRASCRITTO' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5, cost: 0.0001 } });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'g', choices: [{ delta: { content: '1, 2, 3' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5, cost: 0.0001 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (url === '/api/v1/auth/key') {
        if (bearer !== OWN_KEY) return json(res, 401, { error: { message: 'User not found.' } });
        return json(res, 200, { data: { label: 'x', limit: 10, usage: 10, limit_remaining: 0 } });
      }
      if (url === '/api/v1/credits') return json(res, 200, { data: { total_credits: 25, total_usage: 5.5 } });
      if (url.startsWith('/v1/projects/') && url.endsWith(':commit')) return json(res, 200, { writeResults: [] });
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

test('«Trascrivi» una zona della pagina con la chiave propria a credito finito: il testo arriva coi crediti di Filo, e un avviso lo dice', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate((_, b) => {
    const vero = globalThis.fetch;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/openrouter\.ai/, b).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
  }, base);
  const credits = await openTab('filo://credits/credits.html');
  await expect(credits.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await credits.fill('#inviteCode', 'abcd-efgh');
  await credits.click('#redeemBtn');
  await expect(credits.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
  await credits.fill('#ownKeyInput', OWN_KEY);
  await credits.click('#ownKeySaveBtn');
  await expect(credits.locator('#ownKeyHave')).toBeVisible({ timeout: 15000 });

  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Scansione</title>'
    + '<p id="p1" style="font:28px sans-serif;margin:120px 40px">Un testo da trascrivere</p>');
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
  await page.locator('#p1').click({ button: 'right', position: { x: 5, y: 5 } });
  await page.locator('.sn-menu-row-overflow').hover();
  await page.locator('.sn-menu-row-overflow').click().catch(() => {});
  await page.locator('[data-sn-icon-id="transcribe"]').click();
  await expect(page.locator('.sn-region-overlay')).toBeVisible({ timeout: 10000 });
  await page.mouse.move(30, 100);
  await page.mouse.down();
  await page.mouse.move(300, 140, { steps: 5 });
  await page.mouse.move(500, 180, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__toasts.join(' | ')), { timeout: 30_000 }).toMatch(/copiat|trascritt/i);
  await page.waitForTimeout(1500);
  const toasts = await page.evaluate(() => window.__toasts.join(' | '));
  const chiavi = prove.map((k) => (k === OWN_KEY ? 'propria' : k === PERSONAL_KEY ? 'personale' : k));
  console.log('[nota]', `chiavi: ${JSON.stringify(chiavi)}; avvisi: «${toasts}»`);
  expect(chiavi).toEqual(['propria', 'personale']);
  expect(toasts).toContain('ho usato i crediti di Filo');
});
