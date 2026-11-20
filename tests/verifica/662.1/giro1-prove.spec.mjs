import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { premiNellaBarra } from '../../helpers/barra.mjs';

// Verifica #662.1, giro 1: il ripiego sui crediti di Filo vale come detto solo quando una pagina in vista l'ha mostrato.
const OWN_KEY = 'sk-or-v1-own-key-123456';
const PERSONAL_KEY = 'sk-or-v1-test-personal';
const PSEUDONYM = 'abcdef0123456789';

let server;
let base = '';
const seen = { completions: [] };
let personalDelayMs = 0;
let redeemed = false;

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
        return json(res, 200, { result: { hasWallet: true, pseudonym: PSEUDONYM, balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.0084, remainingUsd: 4.1916, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletRedeem') {
        redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: PERSONAL_KEY, pseudonym: PSEUDONYM, credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } });
      }
      if (url === '/api/v1/chat/completions') {
        seen.completions.push({ key: bearer, stream: body.stream === true });
        if (bearer === OWN_KEY) return json(res, 402, { error: { message: 'no', code: 402 } });
        if (bearer !== PERSONAL_KEY) return json(res, 401, { error: { message: 'User not found.', code: 401 } });
        if (personalDelayMs) await new Promise((r) => setTimeout(r, personalDelayMs));
        const text = 'Ciao: RISPOSTA-DALLA-PERSONALE.';
        if (body.stream !== true) {
          return json(res, 200, { id: 'gen-1', provider: 'Fake', choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.00021 } });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'gen-1', provider: 'Fake', choices: [{ delta: { content: text } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.00021 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (url === '/api/v1/auth/key') {
        if (bearer !== OWN_KEY) return json(res, 401, { error: { message: 'User not found.' } });
        return json(res, 200, { data: { label: 'la mia', limit: 10, usage: 1.5, limit_remaining: 8.5 } });
      }
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
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => {
  seen.completions.length = 0;
  personalDelayMs = 0;
  redeemed = false;
});

async function prepare(app) {
  await app.evaluate((_, b) => {
    if (!globalThis.__filoFetchVero) {
      const vero = globalThis.fetch;
      globalThis.__filoFetchVero = vero;
      globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/openrouter\.ai/, b).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
    }
  }, base);
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

async function redeemWallet(openTab) {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await page.fill('#inviteCode', 'abcd-efgh');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
  return page;
}

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function osservaAvvisi(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    for (const n of document.querySelectorAll('.sn-toast')) window.__toasts.push(n.textContent || '');
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => (window.__toasts || []).join(' | '));
}

async function selezionaColMouse(page, sel) {
  const box = await page.locator(sel).boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

// Il primo piano tolto dove l'avviso lo controlla: la finestra per il main, la pagina per sé.
async function fuoriDaFilo(app, page) {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    win.isFocused = () => false;
  });
  await page.evaluate(() => { document.hasFocus = () => false; });
}
async function tornaSuFilo(app, page) {
  await page.evaluate(() => { document.hasFocus = () => true; });
  await app.evaluate(({ app: a, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    win.isFocused = () => true;
    a.emit('browser-window-focus', {}, win);
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

const FRASE = '<!doctype html><meta charset="utf-8"><title>Prova</title>'
  + '<p id="t" style="font:28px sans-serif;margin:120px 40px">La fotosintesi trasforma la luce.</p>';

test('passi della segnalazione: spiegazione preparata con Filo dietro un\'altra applicazione, tornati l\'avviso compare', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app);
  const page = await testServer.openReady(openTab, FRASE);
  const avvisi = await osservaAvvisi(page);
  await selezionaColMouse(page, '#t');
  await fuoriDaFilo(app, page);
  await expect.poll(() => seen.completions.filter((c) => c.key === PERSONAL_KEY).length, { timeout: 20000 }).toBeGreaterThan(0);
  await page.waitForTimeout(8000);
  expect(await avvisi()).not.toContain('crediti di Filo');
  await tornaSuFilo(app, page);
  await expect.poll(avvisi, { timeout: 10000 }).toContain('crediti di Filo');
  await page.screenshot({ path: 'tests/.shots/662.1-g1-ritorno.png' }).catch(() => {});
});

const ARTICOLO = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Article</title><body>'
  + Array.from({ length: 30 }, (_, i) => `<p>Paragraph number ${i} of the body text, deliberately long enough to need several separate requests for the whole article to be translated.</p>`).join('')
  + '<a id="via" href="/altra">next</a></body></html>';

test('«Traduci la pagina» lasciata prima della fine: la pagina dopo dice il ripiego', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  personalDelayMs = 1500;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app);
  const page = await testServer.openReady(openTab, ARTICOLO);
  await premiNellaBarra(app, 'translate');
  await expect.poll(() => seen.completions.filter((c) => c.key === PERSONAL_KEY).length, { timeout: 20000 }).toBeGreaterThan(0);
  await page.evaluate(() => { location.href = 'data:text/html,<p>altra pagina</p>'; }).catch(() => {});
  await page.waitForTimeout(300);
  const dopo = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Dopo</title><p>Un\'altra pagina.</p>');
  const avvisi = await osservaAvvisi(dopo);
  await expect.poll(avvisi, { timeout: 15000 }).toContain('crediti di Filo');
});

test('risposta della home arrivata mentre la home sta dietro: la spiegazione pagata dopo sulla pagina in vista lo dice', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  personalDelayMs = 4000;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  await redeemWallet(openTab);
  await prepare(app);
  await home.bringToFront().catch(() => {});
  await home.locator('#input').fill('ciao');
  await home.locator('#sendBtn').click();
  await expect.poll(() => seen.completions.filter((c) => c.key === PERSONAL_KEY).length, { timeout: 15000 }).toBeGreaterThan(0);
  const page = await testServer.openReady(openTab, FRASE);
  const avvisi = await osservaAvvisi(page);
  await expect(home.locator('.dash-bubble-note')).toContainText('crediti di Filo', { timeout: 30000 });
  // La scheda davanti è la pagina, non la home: la riga è arrivata in una scheda dietro.
  const davanti = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return String((t && (t.url || (t.view && t.view.webContents.getURL()))) || '');
  });
  expect(davanti).toContain('127.0.0.1');
  await page.waitForTimeout(6000);
  const prima = seen.completions.length;
  await selezionaColMouse(page, '#t');
  await expect.poll(() => seen.completions.slice(prima).filter((c) => c.key === PERSONAL_KEY).length, { timeout: 20000 }).toBeGreaterThan(0);
  await expect.poll(avvisi, { timeout: 15000 }).toContain('crediti di Filo');
});
