import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const OWN_KEY = 'sk-or-v1-own-key-123456';
const PERSONAL_KEY = 'sk-or-v1-test-personal';
const PSEUDONYM = 'abcdef0123456789';

let server;
let base = '';
const seen = { completions: [], commits: [], keyInfo: [], credits: [] };
let ownKeyStatus = 401; // cosa risponde OpenRouter alla chiave propria
let personalKeyStatus = 200; // …e alla personale (402 = anche i crediti di Filo finiti)
let ownKeyLimit = 10;   // il tetto della chiave propria; null = nessun tetto
let ownKeyUsage = 1.5;  // quanto la chiave propria ha speso, secondo OpenRouter
let personalDelayMs = 0; // la personale risponde in ritardo (riquadri chiusi prima, prove in parallelo)
let personalDrop = false; // la personale chiude la connessione senza risposta
let redeemed = false;   // il portafoglio esiste solo dopo il riscatto (ogni test riparte da zero)

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
      const auth = String(req.headers.authorization || '');
      const bearer = auth.replace(/^Bearer\s+/i, '');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/api/v1/chat/completions' && bearer === PERSONAL_KEY) {
        if (personalDrop) { req.socket.destroy(); return; }
      }

      // ── Identità anonima e funzioni wallet* ──
      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      }
      if (url === '/token') {
        return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      }
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: PSEUDONYM,
            balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.0084, remainingUsd: 4.1916, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100, invites: [],
          },
        });
      }
      if (url === '/walletRedeem') {
        redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: PERSONAL_KEY, pseudonym: PSEUDONYM, credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } });
      }

      // ── OpenRouter ──
      if (url === '/api/v1/chat/completions') {
        // Si registra l'ULTIMO messaggio: dopo un turno Filo fa altre chiamate
        // (la home si rigenera con la conversazione dentro), e quelle non sono
        // il turno di chat.
        const msgs = Array.isArray(body.messages) ? body.messages : [];
        const last = msgs[msgs.length - 1] || {};
        seen.completions.push({ key: bearer, model: body.model, tools: Array.isArray(body.tools) && body.tools.length > 0, lastRole: last.role || '', lastText: JSON.stringify(last.content || '') });
        const status = bearer === OWN_KEY ? ownKeyStatus : (bearer === PERSONAL_KEY ? personalKeyStatus : 401);
        if (personalDelayMs && bearer === PERSONAL_KEY) await new Promise((r) => setTimeout(r, personalDelayMs));
        // Il 403 è quello della moderazione, come lo scrive OpenRouter: non è la chiave.
        if (status === 403) return json(res, 403, { error: { message: 'Your chosen model requires moderation and your input was flagged', code: 403, metadata: { reasons: ['x'], flagged_input: '…' } } });
        if (status !== 200) return json(res, status, { error: { message: status === 401 ? 'User not found.' : 'no', code: status } });
        const who = bearer === PERSONAL_KEY ? 'RISPOSTA-DALLA-PERSONALE' : 'RISPOSTA-DALLA-PROPRIA';
        // Le richieste senza streaming (la spiegazione nel menu, il riquadro di modifica) vogliono il JSON intero.
        if (body.stream !== true) {
          return json(res, 200, { id: 'gen-1', provider: 'Fake', choices: [{ message: { content: `Ciao: ${who}.` }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.00021 } });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'gen-1', provider: 'Fake', choices: [{ delta: { content: `Ciao: ${who}.` } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.00021 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (url === '/api/v1/auth/key') {
        seen.keyInfo.push(bearer);
        if (bearer !== OWN_KEY && !bearer.startsWith('sk-or-v1-new')) return json(res, 401, { error: { message: 'User not found.' } });
        if (ownKeyLimit == null) return json(res, 200, { data: { label: 'la mia', limit: null, usage: ownKeyUsage, limit_remaining: null } });
        return json(res, 200, { data: { label: 'la mia', limit: ownKeyLimit, usage: ownKeyUsage, limit_remaining: ownKeyLimit - ownKeyUsage } });
      }
      // Il credito dell'account: quello che resta a una chiave senza tetto.
      if (url === '/api/v1/credits') {
        seen.credits.push(bearer);
        return json(res, 200, { data: { total_credits: 25, total_usage: 5.5 } });
      }
      if (url === '/api/v1/generation') return json(res, 404, { error: { message: 'not yet' } });

      // ── Firestore: la riga d'uso ──
      if (url.startsWith('/v1/projects/') && url.endsWith(':commit')) {
        seen.commits.push({ auth: bearer, writes: body.writes || [] });
        return json(res, 200, { writeResults: (body.writes || []).map(() => ({})) });
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

test.beforeEach(() => {
  seen.completions.length = 0;
  seen.commits.length = 0;
  seen.keyInfo.length = 0;
  seen.credits.length = 0;
  ownKeyStatus = 401;
  personalKeyStatus = 200;
  ownKeyLimit = 10;
  ownKeyUsage = 1.5;
  redeemed = false;
  personalDelayMs = 0;
  personalDrop = false;
});

// OpenRouter e Firestore hanno l'indirizzo scritto nel codice: nel main il
// `fetch` globale li ridirige al finto. Tutto il resto passa com'è.
async function redirectHosts(app) {
  await app.evaluate((_, b) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => {
      let u = String(url);
      u = u.replace(/^https:\/\/openrouter\.ai/, b).replace(/^https:\/\/firestore\.googleapis\.com/, b);
      return vero(u, init);
    };
  }, base);
}

// Portafoglio con chiave personale (riscatto dal finto server), modelli
// propri e chiave PROPRIA scritta dall'utente.
async function prepare(app, { ownKey = OWN_KEY } = {}) {
  await redirectHosts(app);
  await app.evaluate(async (_, k) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: k },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  }, ownKey);
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


// Verifica #662, giro 5: porte ri-provate e chiuse (i passi della segnalazione, prova in parallelo, ripiego caduto).
const RIGA402 = 'OpenRouter ha rifiutato la tua chiave (il suo credito è finito): ho usato i crediti di Filo.';
const CONTA = 'Conta da 1 a 20';

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
async function selezionaColMouse(page, sel) {
  const box = await page.locator(sel).boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}
const spiega = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  globalThis.__filoShortcuts.dispatch('explain-selection', win);
});

test('E1 i passi della segnalazione: frase selezionata col mouse e scorciatoia di «spiega»: la riga nel riquadro, una volta sola', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 402;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Prova</title>'
    + '<p id="t" style="font:28px sans-serif;margin:120px 40px">La fotosintesi trasforma la luce.</p>');
  const avvisi = await osservaAvvisi(page);
  await selezionaColMouse(page, '#t');
  await page.waitForTimeout(800);
  await spiega(app);
  const popup = page.locator('.sn-popup');
  await expect(popup).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30000 });
  await expect(popup.locator('.sn-key-fallback')).toHaveText(RIGA402);
  await page.waitForTimeout(7000);
  await page.screenshot({ path: 'tests/.shots/662-g5-e1.png' }).catch(() => {});
  console.log('E1 avvisi:', await avvisi());
  expect(await avvisi()).not.toContain('crediti di Filo');
});

test('E3 «Prova» premuto mentre una risposta della chat è in volo: la prova dice il rifiuto, la chat ripiega e lo dice', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 402;
  personalDelayMs = 5000;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  await redeemWallet(openTab);
  await prepare(app);
  const options = await openTab('filo://options/options.html');
  await expect.poll(() => options.locator('#apiKey').inputValue(), { timeout: 15000 }).toBe(OWN_KEY);
  await home.bringToFront().catch(() => {});
  await home.locator('#input').fill('ciao in parallelo');
  await home.locator('#sendBtn').click();
  await expect.poll(() => seen.completions.filter((c) => c.key === PERSONAL_KEY).length, { timeout: 15000 }).toBeGreaterThan(0);
  await options.bringToFront().catch(() => {});
  await options.click('#testOpenrouter');
  const status = options.locator('#testOpenrouterStatus');
  await expect(status).toContainText('OpenRouter ha rifiutato questa chiave (il suo credito è finito)', { timeout: 30000 });
  expect(seen.completions.filter((c) => c.lastText.includes(CONTA)).map((c) => c.key)).toEqual([OWN_KEY]);
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30000 });
  await expect(home.locator('.dash-bubble-note')).toContainText('ho usato i crediti di Filo');
});

test('E5 il ripiego cade per una connessione chiusa: Crediti non dice che Filo ha usato i crediti', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 402;
  personalDrop = true;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  const credits = await redeemWallet(openTab);
  await prepare(app);
  await home.bringToFront().catch(() => {});
  await home.locator('#input').fill('ciao connessione chiusa');
  await home.locator('#sendBtn').click();
  await home.waitForTimeout(8000);
  console.log('E5 chat:', await home.locator('.dash-bubble-filo').last().textContent().catch(() => '?'));
  await credits.reload();
  await expect(credits.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15000 });
  console.log('E5 crediti:', await credits.locator('#ownKeyRefusal').textContent());
  await expect(credits.locator('#ownKeyRefusal')).not.toContainText('ha usato i tuoi crediti');
});
