// Verifica #662, giro 2: con la chiave propria rifiutata la riga del ripiego sta già
// sotto la risposta (chat della home, Aiuto); nessun avviso deve ripeterla.
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
        prove.push(bearer);
        if (bearer !== PERSONAL_KEY) return json(res, 402, { error: { message: 'no', code: 402 } });
        if (body.stream !== true) return json(res, 200, { id: 'g', choices: [{ message: { content: 'RISPOSTA-DAI-CREDITI' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5, cost: 0.0001 } });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'g', choices: [{ delta: { content: 'RISPOSTA-DAI-CREDITI' } }] })}\n\n`);
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
const RIGA = 'ho usato i crediti di Filo';

async function preparaPortafoglioEChiave(app, openTab) {
  await app.evaluate((_, b) => {
    const vero = globalThis.fetch;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/openrouter\.ai/, b).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
  }, base);
  const credits = await openTab('filo://credits/credits.html');
  await expect(credits.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await credits.fill('#inviteCode', 'abcd-efgh');
  await credits.click('#redeemBtn');
  await expect(credits.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
  await app.evaluate(async (_, k) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: k },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  }, OWN_KEY);
}

async function osservaAvvisi(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => window.__toasts.join(' | '));
}

test.beforeEach(() => { redeemed = false; prove.length = 0; });

test('chat della home con la chiave propria a credito finito: la riga sotto la risposta lo dice, e nessun avviso ripete la stessa frase', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let home = null;
  for (let i = 0; i < 100 && !home; i++) {
    home = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    if (!home) await new Promise((r) => setTimeout(r, 100));
  }
  await home.waitForLoadState('domcontentloaded');
  await expect(home.locator('#input')).toBeVisible();
  await preparaPortafoglioEChiave(app, openTab);
  await home.bringToFront().catch(() => {});
  const avvisi = await osservaAvvisi(home);
  await home.locator('#input').fill('ciao ripiego');
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA-DAI-CREDITI', { timeout: 30000 });
  await expect(home.locator('.dash-bubble-note')).toContainText(RIGA);
  await home.waitForTimeout(10_000);
  expect(await avvisi()).not.toContain(RIGA);
});

test('l’Aiuto della pagina con la chiave propria a credito finito: la riga nella conversazione lo dice, e nessun avviso ripete la stessa frase', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaPortafoglioEChiave(app, openTab);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Sito</title><p>Un sito qualunque.</p>');
  const avvisi = await osservaAvvisi(page);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await page.fill('.sn-sidebar-input textarea', 'dove sono le impostazioni?');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect(page.locator('.sn-sidebar-msg-assistant').last()).toContainText('RISPOSTA-DAI-CREDITI', { timeout: 30_000 });
  await expect(page.locator('.sn-sidebar-log', { hasText: RIGA })).toHaveCount(1);
  await page.waitForTimeout(8_000);
  expect(await avvisi()).not.toContain(RIGA);
});
