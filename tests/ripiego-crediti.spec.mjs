// Chiave propria rifiutata: ripiego sui crediti di Filo, e chiave gestita dalla
// pagina Crediti (#629).
//
// Un solo HTTP locale finge tutto quello che sta fuori: OpenRouter (che
// rifiuta la chiave PROPRIA con 401 e serve la PERSONALE), l'identità anonima
// Firebase, le funzioni wallet* e Firestore (dove arriva la riga d'uso).
// Le funzioni e l'identità si spostano con le variabili d'ambiente prima
// del lancio; OpenRouter e Firestore hanno l'indirizzo scritto nel codice, e
// nel main si sostituisce `fetch` con uno che ridirige quei due host qui.
//
// Cosa si asserisce, dal punto di vista di chi usa Filo:
//  (A) con la chiave propria rifiutata la risposta ARRIVA in chat (servita
//      dalla chiave personale), sotto c'è la riga che lo dice, e la riga
//      d'uso parte verso Firestore col suo pseudonimo. Senza il ripiego la
//      chat mostrerebbe un errore: rosso.
//  (B) con la chiave propria valida: una chiamata sola, nessuna riga, nessun
//      avviso.
//  (C) la pagina Crediti: la chiave si vede («…ultimi sei»), spesa e residuo
//      arrivano da OpenRouter, l'ultimo rifiuto è scritto; si toglie con
//      conferma e si mette dal campo; Impostazioni e Crediti sono lo stesso
//      campo, in tutte e due le direzioni.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

const OWN_KEY = 'sk-or-v1-own-key-123456';
const PERSONAL_KEY = 'sk-or-v1-test-personal';
const PSEUDONYM = 'abcdef0123456789';

let server;
let base = '';
const seen = { completions: [], commits: [], keyInfo: [] };
let ownKeyStatus = 401; // cosa risponde OpenRouter alla chiave propria
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
        if (status !== 200) return json(res, status, { error: { message: status === 401 ? 'User not found.' : 'no', code: status } });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const who = bearer === PERSONAL_KEY ? 'RISPOSTA-DALLA-PERSONALE' : 'RISPOSTA-DALLA-PROPRIA';
        res.write(`data: ${JSON.stringify({ id: 'gen-1', provider: 'Fake', choices: [{ delta: { content: `Ciao: ${who}.` } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.00021 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (url === '/api/v1/auth/key') {
        seen.keyInfo.push(bearer);
        if (bearer !== OWN_KEY && !bearer.startsWith('sk-or-v1-new')) return json(res, 401, { error: { message: 'User not found.' } });
        if (ownKeyLimit == null) return json(res, 200, { data: { label: 'la mia', limit: null, usage: 1.5, limit_remaining: null } });
        return json(res, 200, { data: { label: 'la mia', limit: ownKeyLimit, usage: 1.5, limit_remaining: ownKeyLimit - 1.5 } });
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
  ownKeyStatus = 401;
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

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('(A) chiave propria rifiutata: la risposta arriva coi crediti di Filo, la chat lo dice, la riga d’uso parte', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  await redeemWallet(openTab);
  await prepare(app);

  // Si torna alla home e si chiede qualcosa.
  await home.bringToFront().catch(() => {});
  await home.locator('#input').fill('ciao ripiego');
  await home.locator('#sendBtn').click();

  // SUCCESSO: la risposta c'è, ed è quella servita dalla chiave personale.
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30000 });
  // La riga discreta sotto la risposta.
  const note = home.locator('.dash-bubble-note[data-key-fallback="401"]');
  await expect(note).toBeVisible();
  await expect(note).toContainText('crediti di Filo');
  // Nessuna bolla d'errore.
  await expect(home.locator('.dash-bubble-actions button', { hasText: 'Riprova' })).toHaveCount(0);
  // Una foto della riga, chiara e scura, da guardare (tests/agent/.out/629/,
  // cartella non tracciata). La home applica il tema da sé al cambio.
  await home.screenshot({ path: 'tests/agent/.out/629/chat-nota-chiaro.png' }).catch(() => {});
  await home.evaluate(async () => { await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }); });
  await new Promise((r) => setTimeout(r, 800));
  await home.screenshot({ path: 'tests/agent/.out/629/chat-nota-scuro.png' }).catch(() => {});

  // OpenRouter ha visto DUE chiamate per questo messaggio: prima la propria
  // (rifiutata), poi la personale, con lo stesso messaggio.
  const mine = seen.completions.filter((c) => c.tools && c.lastRole === 'user' && c.lastText.includes('ciao ripiego'));
  expect(mine.map((c) => c.key)).toEqual([OWN_KEY, PERSONAL_KEY]);

  // La riga d'uso parte verso Firestore col pseudonimo del portafoglio e il
  // token dell'installazione: è una chiamata pagata dalla chiave personale.
  await expect.poll(() => seen.commits.length, { timeout: 20000 }).toBeGreaterThan(0);
  const write = seen.commits[0].writes[0];
  expect(seen.commits[0].auth).toBe('anon-id-token');
  expect(write.update.name).toMatch(/\/wallet-usage\/[A-Za-z0-9]{20}$/);
  expect(write.currentDocument).toEqual({ exists: false });
  const f = write.update.fields;
  expect(f.pseudonym.stringValue).toBe(PSEUDONYM);
  expect(f.action.stringValue).toBeTruthy();
  expect(f.model.stringValue).toContain('deepseek');
  expect(Number(f.promptTokens.integerValue)).toBe(12);
  expect(Number(f.completionTokens.integerValue)).toBe(5);
  expect(f.costUsd.doubleValue).toBeCloseTo(0.00021, 6);
  expect(Object.keys(f).sort()).toEqual(['action', 'at', 'completionTokens', 'costUsd', 'credits', 'model', 'promptTokens', 'pseudonym', 'servedBy'].sort());

  // La pagina Crediti ricorda il rifiuto. (openTab ritrova la scheda già
  // aperta dal riscatto: si ricarica, così la prova non dipende dall'avviso.)
  const credits = await openTab('filo://credits/credits.html');
  await credits.reload();
  await expect(credits.locator('#ownKeyHave')).toBeVisible({ timeout: 15000 });
  await expect(credits.locator('#ownKeyTail')).toHaveText('…123456');
  await expect(credits.locator('#ownKeyRefusal')).toBeVisible();
  await expect(credits.locator('#ownKeyRefusal')).toContainText('prova prima lei');
});

test('(B) chiave propria valida: una chiamata sola, nessun avviso, nessuna riga d’uso', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  ownKeyStatus = 200;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  await redeemWallet(openTab);
  await prepare(app);

  await home.locator('#input').fill('ciao propria');
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA-DALLA-PROPRIA', { timeout: 30000 });
  await expect(home.locator('.dash-bubble-note')).toHaveCount(0);
  const mine = seen.completions.filter((c) => c.tools && c.lastRole === 'user' && c.lastText.includes('ciao propria'));
  expect(mine.map((c) => c.key)).toEqual([OWN_KEY]);
  // Con la chiave propria il consumo è affar suo: nessuna riga (si aspetta
  // più del ritardo di scrittura, che è di tre secondi).
  await new Promise((r) => setTimeout(r, 6000));
  expect(seen.commits.length).toBe(0);

  const credits = await openTab('filo://credits/credits.html');
  await credits.reload();
  await expect(credits.locator('#ownKeyHave')).toBeVisible({ timeout: 15000 });
  await expect(credits.locator('#ownKeyRefusal')).toBeHidden();
  await expect(credits.locator('#ownKeyRule')).toContainText('prova prima lei');
});

test('(C) la pagina Crediti gestisce la chiave: si vede, dice spesa e residuo, si toglie con conferma, si mette; Impostazioni e Crediti sono lo stesso campo', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app);
  // Un rifiuto già registrato (come dopo un ripiego).
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setRaw('walletOwnKeyRefusal', { at: '2026-09-18T07:41:00.000Z', status: 402, detail: '' });
  });

  const page = await openTab('filo://credits/credits.html');
  await page.reload();
  const have = page.locator('#ownKeyHave');
  await expect(have).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#ownKeyForm')).toBeHidden();
  await expect(page.locator('#ownKeyTail')).toHaveText('…123456');
  // Spesa e residuo li dice OpenRouter per QUELLA chiave.
  await expect(page.locator('#ownKeyBalance')).toHaveText('Spesi 1,50 $ · restano 8,50 $ su 10,00 $', { timeout: 10000 });
  expect(seen.keyInfo).toContain(OWN_KEY);
  await expect(page.locator('#ownKeyRefusal')).toContainText('18 set');
  await expect(page.locator('#ownKeyRefusal')).toContainText('credito è finito');

  // Togliere chiede conferma; «Annulla» non toglie niente.
  await page.click('#ownKeyRemoveBtn');
  await expect(page.locator('#ownKeyConfirm')).toBeVisible();
  await page.click('#ownKeyRemoveNo');
  await expect(page.locator('#ownKeyConfirm')).toBeHidden();
  await expect(have).toBeVisible();
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter)).toBe(OWN_KEY);

  // Confermando, la chiave sparisce dalle impostazioni (stringa vuota, come
  // fanno le Impostazioni) e con lei il rifiuto registrato.
  await page.click('#ownKeyRemoveBtn');
  await page.click('#ownKeyRemoveYes');
  await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 10000 });
  await expect(have).toBeHidden();
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter)).toBe('');
  expect(await app.evaluate(async () => globalThis.SN_STORAGE.getRaw('walletOwnKeyRefusal', null))).toBeNull();
  // Nelle Impostazioni il campo è vuoto: stesso campo.
  const options = await openTab('filo://options/options.html');
  await expect.poll(() => options.locator('#apiKey').inputValue(), { timeout: 10000 }).toBe('');

  // Si mette dal campo di Crediti: vuoto e soli spazi non passano.
  await page.bringToFront().catch(() => {});
  await page.fill('#ownKeyInput', '   ');
  await page.click('#ownKeySaveBtn');
  await expect(page.locator('#ownKeyMsg')).toBeVisible();
  await expect(page.locator('#ownKeyForm')).toBeVisible();
  await page.fill('#ownKeyInput', ' sk-or-v1-new-key-654321 ');
  await page.click('#ownKeySaveBtn');
  await expect(have).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#ownKeyTail')).toHaveText('…654321');
  await expect(page.locator('#ownKeyRefusal')).toBeHidden();
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter)).toBe('sk-or-v1-new-key-654321');
  // …e le Impostazioni la vedono (ricaricate: quella pagina legge all'apertura).
  await options.reload();
  await expect.poll(() => options.locator('#apiKey').inputValue(), { timeout: 10000 }).toBe('sk-or-v1-new-key-654321');

  // Strada inversa: cambiata dalle Impostazioni, la pagina Crediti aperta
  // accanto si aggiorna da sola.
  await options.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { apiKeys: { openrouter: 'sk-or-v1-new-key-999999' } } });
  });
  await expect(page.locator('#ownKeyTail')).toHaveText('…999999', { timeout: 10000 });
  await options.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { apiKeys: { openrouter: '' } } });
  });
  await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 10000 });
});
