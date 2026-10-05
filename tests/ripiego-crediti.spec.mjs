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

// Le quattro porte del primo giro di verifica del ramo.
test('(D) chiave senza tetto: resta il credito dell’account; senza portafoglio il «Togli» non promette crediti di Filo e la chat dice che è la TUA chiave a secco; con tutte e due a secco lo dice', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 402;
  ownKeyLimit = null;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  await prepare(app); // chiave propria, NESSUN portafoglio

  // Senza portafoglio: la domanda del «Togli» non parla di crediti di Filo.
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#ownKeyHave')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#ownKeyRule')).toContainText('Paghi tu');
  await page.click('#ownKeyRemoveBtn');
  await expect(page.locator('#ownKeyConfirmText')).not.toContainText('crediti di Filo');
  await expect(page.locator('#ownKeyConfirmText')).toContainText('invito');
  await page.click('#ownKeyRemoveNo');
  // Chiave senza tetto: la riga dice quanto resta sul conto (25 − 5,5).
  await expect(page.locator('#ownKeyBalance')).toHaveText('Spesi 1,50 $ · restano 19,50 $ sul tuo conto OpenRouter', { timeout: 10000 });
  expect(seen.credits).toContain(OWN_KEY);

  // In chat, senza portafoglio: è la TUA chiave a essere a secco, e la strada
  // è un invito (non «i crediti di domani», che non arrivano).
  await home.bringToFront().catch(() => {});
  await home.locator('#input').fill('ciao senza portafoglio');
  await home.locator('#sendBtn').click();
  const err1 = home.locator('.dash-bubble-filo').last();
  await expect(err1).toContainText('a tua chiave OpenRouter non ha più credito', { timeout: 30000 });
  await expect(err1).toContainText('invito');
  await expect(err1).not.toContainText('domani');
  await expect(home.locator('.dash-bubble-actions button', { hasText: 'Apri Crediti' })).toHaveCount(1);

  // Col portafoglio ma anche la personale a secco: lo dice, e dice di domani.
  await redeemWallet(openTab);
  personalKeyStatus = 402;
  await home.bringToFront().catch(() => {});
  await home.locator('#input').fill('ciao tutte e due');
  await home.locator('#sendBtn').click();
  const err2 = home.locator('.dash-bubble-filo').last();
  await expect(err2).toContainText('anche i crediti di Filo sono finiti', { timeout: 30000 });
  await expect(err2).toContainText('domani ne arrivano 100');
  const mine = seen.completions.filter((c) => c.tools && c.lastRole === 'user' && c.lastText.includes('ciao tutte e due'));
  expect(mine.map((c) => c.key)).toEqual([OWN_KEY, PERSONAL_KEY]);
  // E il «Togli» adesso parla dei crediti di Filo.
  await page.reload();
  await expect(page.locator('#ownKeyHave')).toBeVisible({ timeout: 15000 });
  await page.click('#ownKeyRemoveBtn');
  await expect(page.locator('#ownKeyConfirmText')).toContainText('crediti di Filo');
});

test('(E) le Impostazioni già aperte non si portano via la chiave messa in Crediti (né rimettono quella tolta)', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app, { ownKey: '' }); // modelli propri, campo della chiave vuoto
  const options = await openTab('filo://options/options.html');
  await expect(options.locator('#apiKey')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => options.locator('#apiKey').inputValue(), { timeout: 10000 }).toBe('');

  // La chiave si mette in Crediti, con le Impostazioni ancora aperte.
  const page = await openTab('filo://credits/credits.html');
  await page.reload();
  await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 15000 });
  await page.fill('#ownKeyInput', OWN_KEY);
  await page.click('#ownKeySaveBtn');
  await expect(page.locator('#ownKeyHave')).toBeVisible({ timeout: 10000 });
  // Le Impostazioni si sono riallineate da sole…
  await expect.poll(() => options.locator('#apiKey').inputValue(), { timeout: 10000 }).toBe(OWN_KEY);
  // …e un cambio qualunque lì non tocca la chiave.
  await options.bringToFront().catch(() => {});
  await options.fill('#monthlyLimit', '7');
  await options.dispatchEvent('#monthlyLimit', 'change');
  await new Promise((r) => setTimeout(r, 1500));
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter)).toBe(OWN_KEY);
  await expect(page.locator('#ownKeyHave')).toBeVisible();

  // Strada inversa: tolta in Crediti, un altro salvataggio delle Impostazioni non la rimette.
  await page.bringToFront().catch(() => {});
  await page.click('#ownKeyRemoveBtn');
  await page.click('#ownKeyRemoveYes');
  await expect(page.locator('#ownKeyForm')).toBeVisible({ timeout: 10000 });
  await expect.poll(() => options.locator('#apiKey').inputValue(), { timeout: 10000 }).toBe('');
  await options.bringToFront().catch(() => {});
  await options.fill('#monthlyLimit', '8');
  await options.dispatchEvent('#monthlyLimit', 'change');
  await new Promise((r) => setTimeout(r, 1500));
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter)).toBe('');
  await expect(page.locator('#ownKeyForm')).toBeVisible();
});

// ── Secondo giro di verifica del ramo ────────────────────────────────────────
//  (F) il rifiuto ricordato in Crediti si supera da solo quando la chiave torna
//      a rispondere (conto ricaricato), e la riga della spesa si aggiorna con
//      la pagina aperta, senza ricaricarla;
//  (G) un 403 di moderazione non è la chiave: nessun ripiego, nessun rifiuto
//      in Crediti, e la chat parla del contenuto, senza il tasto «Apri Crediti».
test('(F) la chiave torna a funzionare: Crediti dimentica il rifiuto e aggiorna la spesa, a pagina aperta', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  const credits = await redeemWallet(openTab);
  await prepare(app);
  await credits.reload();
  await expect(credits.locator('#ownKeyBalance')).toContainText('Spesi 1,50 $', { timeout: 15000 });

  // Rifiutata (401): il ripiego, e Crediti lo ricorda.
  await home.locator('#input').fill('ciao rifiuto');
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30000 });
  await expect(credits.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15000 });

  // Il conto viene ricaricato: la chiave risponde, e ha speso di più.
  ownKeyStatus = 200;
  ownKeyUsage = 2.5;
  await home.locator('#input').fill('ciao di nuovo');
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA-DALLA-PROPRIA', { timeout: 30000 });
  // SUCCESSO: la pagina Crediti, ancora aperta, non dice più che la chiave è
  // rifiutata, e la riga della spesa è quella nuova. Senza il fix la riga
  // rossa restava (per sempre) e la spesa a 1,50 fino al ricaricamento.
  await expect(credits.locator('#ownKeyRefusal')).toBeHidden({ timeout: 15000 });
  await expect(credits.locator('#ownKeyBalance')).toContainText('Spesi 2,50 $', { timeout: 15000 });
  await expect(credits.locator('#ownKeyRule')).toContainText('prova prima lei');
  // E ricaricata dice lo stesso: il rifiuto è dimenticato davvero, non solo nascosto.
  await credits.reload();
  await expect(credits.locator('#ownKeyHave')).toBeVisible({ timeout: 15000 });
  await expect(credits.locator('#ownKeyRefusal')).toBeHidden();
});

test('(G) un 403 di moderazione non è la chiave: nessun ripiego, nessun rifiuto in Crediti, la chat parla del contenuto', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 403;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  const credits = await redeemWallet(openTab);
  await prepare(app);

  await home.locator('#input').fill('testo segnalato');
  await home.locator('#sendBtn').click();
  const bolla = home.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText('moderazione', { timeout: 30000 });
  await expect(bolla).toContainText('chiave è a posto');
  await expect(bolla.locator('button', { hasText: 'Apri Crediti' })).toHaveCount(0);
  // Una chiamata sola: la stessa richiesta non si rimanda coi crediti di Filo.
  const mine = seen.completions.filter((c) => c.tools && c.lastRole === 'user' && c.lastText.includes('testo segnalato'));
  expect(mine.map((c) => c.key)).toEqual([OWN_KEY]);
  // Crediti non segna un rifiuto.
  await credits.reload();
  await expect(credits.locator('#ownKeyHave')).toBeVisible({ timeout: 15000 });
  await expect(credits.locator('#ownKeyRefusal')).toBeHidden();
  await expect(credits.locator('#ownKeyRule')).toContainText('prova prima lei');
});

// ── #662: le porte rimaste aperte dopo i giri di verifica del #629 ───────────
//  (H) il «Prova» delle Impostazioni (accanto alla chiave e su ogni riga dei
//      modelli) misura LA chiave: rifiutata, lo dice col perché, senza ripiego;
//  (I) «spiega» su una pagina web, dal riquadro e dal tasto destro: la riga
//      della chat sotto la risposta; e così il riquadro di modifica;
//  (J) il ripiego che non produce niente non fa dire a Crediti che Filo ha
//      usato i crediti; quando poi risponde, sì;
//  (K) Crediti aperta: quando arriva il rifiuto anche spesa e residuo si
//      aggiornano, senza ricaricare.
const CONTA = 'Conta da 1 a 20';

test('(H) il «Prova» delle Impostazioni con la chiave propria rifiutata: dice che OpenRouter l’ha rifiutata e perché, senza usare i crediti di Filo', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 402;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const credits = await redeemWallet(openTab);
  await prepare(app);
  const options = await openTab('filo://options/options.html');
  await expect(options.locator('#apiKey')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => options.locator('#apiKey').inputValue(), { timeout: 10000 }).toBe(OWN_KEY);

  await options.click('#testOpenrouter');
  const status = options.locator('#testOpenrouterStatus');
  await expect(status).toContainText('OpenRouter ha rifiutato questa chiave (il suo credito è finito)', { timeout: 30000 });
  await expect(status).not.toContainText('tok/s');
  const prove = () => seen.completions.filter((c) => c.lastText.includes(CONTA)).map((c) => c.key);
  expect(prove()).toEqual([OWN_KEY]);
  await options.screenshot({ path: 'tests/.shots/662-prova-chiave-rifiutata.png' }).catch(() => {});

  // Lo stesso «Prova» sulla riga di un modello: passa dalla stessa strada.
  const row = options.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  await row.locator('.sn-model-test').click();
  await expect(row.locator('.sn-model-row-status')).toContainText('OpenRouter ha rifiutato questa chiave', { timeout: 30000 });
  expect(prove()).toEqual([OWN_KEY, OWN_KEY]);

  // Una prova non salva niente: Crediti non si è segnata un rifiuto (né un uso dei crediti).
  await credits.reload();
  await expect(credits.locator('#ownKeyHave')).toBeVisible({ timeout: 15000 });
  await expect(credits.locator('#ownKeyRefusal')).toBeHidden();

  // Ricaricato il conto, la stessa prova risponde coi tempi della chiave.
  ownKeyStatus = 200;
  await options.click('#testOpenrouter');
  await expect(status).toContainText('tok/s', { timeout: 30000 });
  expect(prove()).toEqual([OWN_KEY, OWN_KEY, OWN_KEY]);
});

test('(I) «spiega» su una pagina con la chiave propria rifiutata: il riquadro, il tasto destro e il riquadro di modifica dicono che hanno pagato i crediti di Filo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  ownKeyStatus = 402;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Prova</title>'
    + '<p id="t" style="font:18px sans-serif;margin:120px 40px">La fotosintesi trasforma la luce in zuccheri.</p>');
  const seleziona = () => page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#t'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });

  // La scorciatoia di «spiega»: il riquadro.
  await seleziona();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  const popup = page.locator('.sn-popup');
  await expect(popup).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30000 });
  const nota = popup.locator('.sn-key-fallback');
  await expect(nota).toHaveText('OpenRouter ha rifiutato la tua chiave (il suo credito è finito): ho usato i crediti di Filo.');
  await page.screenshot({ path: 'tests/.shots/662-spiega-riquadro.png' }).catch(() => {});
  // Una domanda dopo, nello stesso riquadro: anche lei pagata così, anche lei lo dice.
  await popup.locator('.sn-popup-input').fill('e poi?');
  await popup.locator('.sn-popup-input').press('Enter');
  await expect(popup.locator('.sn-key-fallback')).toHaveCount(2, { timeout: 30000 });
  await popup.locator('.sn-popup-close').click();
  await expect(popup).toHaveCount(0);

  // Il tasto destro: la spiegazione nel menu (col tema scuro, da guardare nella foto).
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await seleziona();
  await page.locator('#t').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 10000 });
  const sezione = menu.locator('.sn-menu-inline-explain');
  await expect(sezione).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30000 });
  await expect(sezione.locator('.sn-key-fallback')).toContainText('ho usato i crediti di Filo');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/662-spiega-menu.png' }).catch(() => {});
  await page.keyboard.press('Escape');

  // Con la chiave che torna a rispondere nessuna riga: la risposta l'ha pagata lei.
  ownKeyStatus = 200;
  await page.evaluate(() => { document.querySelector('#t').textContent = 'Un’altra frase, da spiegare con la chiave buona.'; });
  await seleziona();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect(popup).toContainText('RISPOSTA-DALLA-PROPRIA', { timeout: 30000 });
  await expect(popup.locator('.sn-key-fallback')).toHaveCount(0);
});

test('(I2) il riquadro di modifica del testo: la proposta pagata coi crediti di Filo lo dice, e la riga sparisce con la proposta dopo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 401;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Modulo</title>'
    + '<textarea id="campo" style="margin:120px 40px;width:400px;height:80px;font:16px sans-serif">Un testo con un erore.</textarea>');
  // I passi dell'utente: seleziona il testo nella casella, tasto destro, «Modifica», «Correggi».
  await page.locator('#campo').click();
  await page.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await page.locator('#campo').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 10000 });
  await menu.locator('.sn-menu-item', { hasText: 'Modifica' }).click();
  const box = page.locator('.sn-editbox');
  await expect(box).toBeVisible({ timeout: 10000 });
  await box.locator('button[data-sc="fix"]').click();
  await expect(box.locator('.sn-editbox-proposed')).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30000 });
  await expect(box.locator('.sn-key-fallback')).toHaveText('OpenRouter ha rifiutato la tua chiave (non la riconosce): ho usato i crediti di Filo.');
  await page.screenshot({ path: 'tests/.shots/662-modifica.png' }).catch(() => {});
  ownKeyStatus = 200;
  await box.locator('button[data-sc="formal"]').click();
  await expect(box.locator('.sn-editbox-proposed')).toContainText('RISPOSTA-DALLA-PROPRIA', { timeout: 30000 });
  await expect(box.locator('.sn-key-fallback')).toHaveCount(0);
});

test('(J) il ripiego che non produce niente (la personale risponde 500): Crediti ricorda il rifiuto ma non dice che Filo ha usato i crediti; quando il ripiego risponde, sì', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 402;
  personalKeyStatus = 500;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  const credits = await redeemWallet(openTab);
  await prepare(app);

  await home.bringToFront().catch(() => {});
  await home.locator('#input').fill('ciao ripiego caduto');
  await home.locator('#sendBtn').click();
  const mine = () => seen.completions.filter((c) => c.tools && c.lastRole === 'user' && c.lastText.includes('ciao ripiego caduto')).map((c) => c.key);
  await expect.poll(mine, { timeout: 30000 }).toEqual(expect.arrayContaining([OWN_KEY, PERSONAL_KEY]));
  await expect(home.locator('.dash-bubble-note')).toHaveCount(0);
  await credits.reload();
  await expect(credits.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15000 });
  await expect(credits.locator('#ownKeyRefusal')).toContainText('il suo credito è finito');
  await expect(credits.locator('#ownKeyRefusal')).not.toContainText('ha usato i tuoi crediti');
  await expect(credits.locator('#ownKeyRefusal')).toContainText('se la rifiuta, Filo usa i tuoi crediti');
  await credits.screenshot({ path: 'tests/.shots/662-crediti-ripiego-caduto.png' }).catch(() => {});
  expect(seen.commits.length).toBe(0);

  // Il servizio torna: il ripiego risponde, e adesso sì che i crediti sono stati usati.
  personalKeyStatus = 200;
  await home.bringToFront().catch(() => {});
  await home.locator('#input').fill('ciao ripiego riuscito');
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30000 });
  await expect(credits.locator('#ownKeyRefusal')).toContainText('ha usato i tuoi crediti', { timeout: 15000 });
});

test('(K) Crediti aperta quando OpenRouter comincia a rifiutare la chiave: spesa e residuo si aggiornano insieme alla riga del rifiuto', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 200;
  ownKeyUsage = 1.23;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  const credits = await redeemWallet(openTab);
  await prepare(app);
  await credits.reload();
  await expect(credits.locator('#ownKeyBalance')).toHaveText('Spesi 1,23 $ · restano 8,77 $ su 10,00 $', { timeout: 15000 });

  // Il credito finisce mentre la pagina è aperta.
  ownKeyStatus = 402;
  ownKeyUsage = 10;
  await home.bringToFront().catch(() => {});
  await home.locator('#input').fill('ciao credito finito');
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30000 });
  await expect(credits.locator('#ownKeyRefusal')).toBeVisible({ timeout: 15000 });
  await expect(credits.locator('#ownKeyBalance')).toHaveText('Spesi 10,00 $ · restano 0,00 $ su 10,00 $', { timeout: 15000 });
});

test('(L) l’Aiuto della pagina con la chiave propria rifiutata: la riga del ripiego compare una volta, non a ogni risposta pagata così', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 401;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Sito</title><p>Un sito qualunque.</p>');
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  const chiedi = async (testo) => {
    const prima = await page.locator('.sn-sidebar-msg-assistant').count();
    await page.fill('.sn-sidebar-input textarea', testo);
    await page.press('.sn-sidebar-input textarea', 'Enter');
    await expect(page.locator('.sn-sidebar-msg-assistant')).toHaveCount(prima + 1, { timeout: 30_000 });
  };
  const righe = page.locator('.sn-sidebar-log', { hasText: 'ho usato i crediti di Filo' });

  await chiedi('dove sono le impostazioni?');
  await expect(page.locator('.sn-sidebar-msg-assistant').last()).toContainText('RISPOSTA-DALLA-PERSONALE');
  await expect(righe).toHaveCount(1);
  await expect(righe).toContainText('OpenRouter ha rifiutato la tua chiave (non la riconosce)');
  await page.screenshot({ path: 'tests/.shots/662-aiuto.png' }).catch(() => {});
  await chiedi('e il tema scuro?');
  await expect(righe).toHaveCount(1);
  // La chiave risponde di nuovo, poi torna a essere rifiutata: la riga torna.
  ownKeyStatus = 200;
  await chiedi('grazie');
  await expect(page.locator('.sn-sidebar-msg-assistant').last()).toContainText('RISPOSTA-DALLA-PROPRIA');
  ownKeyStatus = 401;
  await chiedi('ancora una cosa');
  await expect(righe).toHaveCount(2);
});

test('(M) «Traduci la pagina» con la chiave propria rifiutata: finito il giro, un avviso dice che hanno pagato i crediti di Filo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 402;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app);
  const page = await testServer.openReady(openTab, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Article</title>'
    + '<p id="p1">The quick brown fox jumps over the lazy dog, again and again, in the morning light.</p>');
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
  await page.locator('#p1').click({ button: 'right', position: { x: 5, y: 5 } });
  await page.locator('[data-sn-icon-id="translate"]').click();
  await expect.poll(() => page.evaluate(() => window.__toasts.join(' | ')), { timeout: 30_000 })
    .toContain('OpenRouter ha rifiutato la tua chiave (il suo credito è finito): ho usato i crediti di Filo.');
});

test('(N) la chat dell’Editor con la chiave propria rifiutata: sotto ogni risposta la stessa riga della chat di Filo', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 402;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="switch"]');
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('.ed-module[data-type="chat"]');
  const input = page.locator('.ed-module[data-type="chat"] [data-chat="input"]');
  await input.click();
  await input.fill('di cosa parla?');
  await input.press('Enter');
  await expect(page.locator('.ed-chat-msg.assistant').last()).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30_000 });
  const nota = page.locator('.ed-chat-note');
  await expect(nota).toHaveText('OpenRouter ha rifiutato la tua chiave (il suo credito è finito): ho usato i crediti di Filo.');
  await page.screenshot({ path: 'tests/.shots/662-editor-chat.png' }).catch(() => {});
  // Una seconda risposta pagata così ha la sua riga; la prima resta sotto la sua.
  await input.fill('e poi?');
  await input.press('Enter');
  await expect(page.locator('.ed-chat-msg.assistant')).toHaveCount(2, { timeout: 30_000 });
  await expect(nota).toHaveCount(2, { timeout: 30_000 });
});

test('(O) il «Prova» delle righe dei modelli predefiniti con la chiave propria rifiutata: dice che OpenRouter l’ha rifiutata e perché, senza ripiego', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  ownKeyStatus = 402;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await redirectHosts(app);
  // «Usa i modelli predefiniti» resta acceso: è lo stato di partenza.
  await app.evaluate(async (_, k) => { await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: k } }); }, OWN_KEY);
  const options = await openTab('filo://options/options.html');
  const row = options.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.locator('.sn-model-test').click();
  await expect(row.locator('.sn-model-row-status')).toContainText('OpenRouter ha rifiutato questa chiave (il suo credito è finito)', { timeout: 30000 });
  const prove = seen.completions.filter((c) => c.lastText.includes(CONTA)).map((c) => c.key);
  expect(prove).toEqual([OWN_KEY]);
});

test('(P) le strade che non scrivono la riga del ripiego lo dicono con un avviso: «Trascrivi» una zona della pagina; «spiega», che la scrive nel riquadro, non ne aggiunge uno', async ({ app, shell, openTab, testServer }) => {
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

  // «Trascrivi» (tasto destro, «Altro…»): il testo arriva coi crediti di Filo, e l'avviso lo dice.
  const prima = seen.completions.length;
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
  await expect.poll(avvisi, { timeout: 10_000 }).toContain(RIGA);
  expect(seen.completions.slice(prima).map((c) => c.key).slice(0, 2)).toEqual([OWN_KEY, PERSONAL_KEY]);

  // «spiega» dopo: la riga sta nel riquadro, e la frase non torna in un secondo avviso.
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#t'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  const popup = page.locator('.sn-popup');
  await expect(popup.locator('.sn-key-fallback')).toHaveText(RIGA, { timeout: 30000 });
  await page.waitForTimeout(1500);
  expect((await avvisi()).split(RIGA).length - 1).toBe(1);
  await popup.locator('.sn-popup-close').click();
});

// La riga sotto la risposta e l'avviso sono la stessa frase: le chiamate che accompagnano la
// richiesta (Filo che impara dalla chat, i lavori sulla pagina) non la ripetono in un avviso.
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

test('(Q) la chat della home con la chiave propria rifiutata: la riga sotto la risposta, e nessun avviso che la ripete', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  ownKeyStatus = 402;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await expect(home.locator('#input')).toBeVisible();
  await redeemWallet(openTab);
  await prepare(app);
  await home.bringToFront().catch(() => {});
  const avvisi = await osservaAvvisi(home);
  await home.locator('#input').fill('ciao ripiego');
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30000 });
  await expect(home.locator('.dash-bubble-note')).toContainText('ho usato i crediti di Filo');
  // Dopo la risposta Filo rilegge la conversazione per imparare: anche quella chiamata ripiega.
  await expect.poll(() => seen.completions.filter((c) => !c.tools && c.key === PERSONAL_KEY).length, { timeout: 15000 }).toBeGreaterThan(0);
  await home.waitForTimeout(6000);
  expect(await avvisi()).not.toContain('crediti di Filo');
});

test('(R) l’Aiuto della pagina con la chiave propria rifiutata: la riga sta sotto la risposta, e nessun avviso la ripete', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  ownKeyStatus = 402;
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Sito</title><p>Un sito qualunque.</p>');
  const avvisi = await osservaAvvisi(page);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await page.fill('.sn-sidebar-input textarea', 'dove sono le impostazioni?');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect(page.locator('.sn-sidebar-msg-assistant').last()).toContainText('RISPOSTA-DALLA-PERSONALE', { timeout: 30_000 });
  const riga = page.locator('.sn-sidebar-log', { hasText: 'ho usato i crediti di Filo' });
  await expect(riga).toHaveCount(1);
  const dopoLaRisposta = await riga.evaluate((el) => {
    const risposta = [...document.querySelectorAll('.sn-sidebar-msg-assistant')].pop();
    return Boolean(risposta && (risposta.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(dopoLaRisposta).toBe(true);
  await page.waitForTimeout(6000);
  expect(await avvisi()).not.toContain('crediti di Filo');
});
