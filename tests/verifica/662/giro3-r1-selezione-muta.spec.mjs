// Verifica #662, giro 3: la selezione di un testo su una pagina fa partire da sola la
// spiegazione (prefetch); pagata col ripiego, nessuno lo dice, e per dieci minuti
// zittisce anche l'avviso delle altre strade (qui «Trascrivi»).
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
let redeemed = false;   // il portafoglio esiste solo dopo il riscatto (ogni test riparte da zero)

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
      const auth = String(req.headers.authorization || '');
      const bearer = auth.replace(/^Bearer\s+/i, '');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }

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


test('selezionare un testo con la chiave propria rifiutata: la spiegazione anticipata paga coi crediti di Filo, e qualcuno lo dice (qui: «Trascrivi» subito dopo)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  ownKeyStatus = 402;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Scansione</title>'
    + '<p id="t" style="font:28px sans-serif;margin:120px 40px">Un testo da trascrivere</p>');
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
  const avvisi = () => page.evaluate(() => window.__toasts.join(' | '));
  const RIGA = 'OpenRouter ha rifiutato la tua chiave (il suo credito è finito): ho usato i crediti di Filo.';

  // L'utente seleziona la frase col mouse (trascinamento) e non apre nessun menu.
  const prima = seen.completions.length;
  const box = await page.locator('#t').boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  console.log('[nota] selezione:', await page.evaluate(() => String(window.getSelection())));
  await expect.poll(() => seen.completions.slice(prima).map((c) => c.key).join(','), { timeout: 15_000 })
    .toContain(`${OWN_KEY},${PERSONAL_KEY}`);
  await page.waitForTimeout(6000);
  const dopoSelezione = await avvisi();
  console.log('[nota] avvisi dopo la sola selezione:', JSON.stringify(dopoSelezione));
  await page.evaluate(() => window.getSelection().removeAllRanges());

  // «Trascrivi» subito dopo: anche questa risposta arriva coi crediti di Filo.
  const primaT = seen.completions.length;
  await page.locator('#t').click({ button: 'right', position: { x: 5, y: 5 } });
  await page.locator('.sn-menu-row-overflow').hover();
  await page.locator('.sn-menu-row-overflow').click().catch(() => {});
  await page.locator('[data-sn-icon-id="transcribe"]').click();
  await expect(page.locator('.sn-region-overlay')).toBeVisible({ timeout: 10000 });
  await page.mouse.move(30, 100);
  await page.mouse.down();
  await page.mouse.move(300, 140, { steps: 5 });
  await page.mouse.move(500, 180, { steps: 5 });
  await page.mouse.up();
  await expect.poll(avvisi, { timeout: 30_000 }).toContain('Testo trascritto e copiato');
  expect(seen.completions.slice(primaT).map((c) => c.key).slice(0, 2)).toEqual([OWN_KEY, PERSONAL_KEY]);
  await page.waitForTimeout(6000);
  const tutti = await avvisi();
  console.log('[nota] avvisi alla fine:', JSON.stringify(tutti));
  // Due risposte pagate coi crediti di Filo, nessuna riga a schermo: almeno un avviso lo deve dire.
  expect(tutti).toContain(RIGA);
});
