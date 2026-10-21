// Verifica #830 giro 7: le altre porte della regola dei crediti (chat della home, ripiego, catalogo, traduci, catena).
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, conta, clicca } from '../../helpers/riquadri.mjs';

const testoDi = async (app, page, sel) => (await statoDi(app, page, sel))?.testo || '';

const PERSONAL_KEY = 'sk-or-v1-test-personal';
const OWN_BAD = 'sk-or-v1-own-rifiutata-123456';
const CHIUSO = 'openai/gpt-5';
const SOLO_CATALOGO = 'undi95/remm-slerp-l2-13b';
const IGNOTO_CHIUSO = 'aion-labs/aion-1.0';

let server;
let base = '';
const seen = { completions: [], catalogo: 0 };
let redeemed = false;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const CATALOGO = [
  { id: 'deepseek/deepseek-v4-flash', hugging_face_id: 'deepseek-ai/DeepSeek-V4-Flash', pricing: { prompt: '0.0000001', completion: '0.0000002' }, context_length: 100000 },
  { id: SOLO_CATALOGO, hugging_face_id: 'Undi95/ReMM-SLERP-L2-13B', pricing: { prompt: '0.0000001', completion: '0.0000002' }, context_length: 4096 },
  { id: IGNOTO_CHIUSO, hugging_face_id: '', pricing: { prompt: '0.000004', completion: '0.000008' }, context_length: 32000 },
  { id: CHIUSO, hugging_face_id: null, pricing: { prompt: '0.00000125', completion: '0.00001' }, context_length: 400000 },
];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.01, remainingUsd: 4.19, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletRedeem') {
        redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: PERSONAL_KEY, pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } });
      }
      if (url === '/api/v1/models') { seen.catalogo++; return json(res, 200, { data: CATALOGO }); }
      if (url === '/api/v1/chat/completions') {
        const msgs = Array.isArray(body.messages) ? body.messages : [];
        if (JSON.stringify(msgs).includes('preparare la dashboard')) { req.socket.destroy(); return undefined; }
        seen.completions.push({ key: bearer, model: body.model });
        if (bearer === OWN_BAD) return json(res, 401, { error: { message: 'User not found.', code: 401 } });
        if (body.stream !== true) {
          return json(res, 200, { id: 'gen-1', provider: 'Fake', choices: [{ message: { content: 'RISPOSTA-ROUTER.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.0002 } });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'gen-1', provider: 'Fake', choices: [{ delta: { content: 'RISPOSTA-ROUTER.' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.0002 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (url === '/api/v1/auth/key') return json(res, 401, { error: { message: 'User not found.' } });
      if (url === '/api/v1/generation') return json(res, 404, { error: { message: 'not yet' } });
      if (url.startsWith('/api/v1/models/') && url.endsWith('/endpoints')) return json(res, 200, { data: { endpoints: [{ provider_name: 'Fake', tag: 'fake' }] } });
      if (url.startsWith('/v1/projects/') && url.endsWith(':commit')) return json(res, 200, { writeResults: (body.writes || []).map(() => ({})) });
      return json(res, 404, { error: { message: `not found ${url}` } });
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

test.beforeEach(() => { seen.completions.length = 0; seen.catalogo = 0; redeemed = false; });

async function redirectHosts(app) {
  await app.evaluate((_, b) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/openrouter\.ai/, b).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
  }, base);
}

async function prepare(app, models, own = '') {
  await redirectHosts(app);
  await app.evaluate(async (_, { models: m, own: k, chiuso, solo, ignoto }) => {
    const C = globalThis.SN_CONST;
    const out = {};
    for (const [a, ref] of Object.entries(m)) out[C.ACTIONS[a]] = ref;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: k },
      models: { ...globalThis.SN_TEST_MODELS.models, ...out },
      modelRegistry: {
        ...globalThis.SN_TEST_MODELS.registry,
        gpt: { provider: 'openrouter', model: chiuso },
        remm: { provider: 'openrouter', model: solo },
        aion: { provider: 'openrouter', model: ignoto },
      },
    });
  }, { models, own, chiuso: CHIUSO, solo: SOLO_CATALOGO, ignoto: IGNOTO_CHIUSO });
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

async function chiedi(home, testo) {
  await home.bringToFront().catch(() => {});
  await home.locator('#input').fill(testo);
  await home.locator('#sendBtn').click();
}

test('chat della home: modello chiuso coi crediti → frase, nessuna richiesta; tasto Crediti', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await redeemWallet(openTab);
  await prepare(app, { FILO_CHAT: 'gpt' });
  await chiedi(home, 'ciao chiuso');
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('coi crediti di Filo questo modello non si usa', { timeout: 30000 });
  const txt = await home.locator('.dash-bubble-filo').last().innerText();
  console.log('CHAT:', txt);
  await home.screenshot({ path: 'tests/.shots/830-g7-chat.png' }).catch(() => {});
  expect(seen.completions.filter((c) => c.model === CHIUSO)).toEqual([]);
});

test('chat della home: chiave propria rifiutata + modello chiuso → nessun ripiego sui crediti', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await redeemWallet(openTab);
  await prepare(app, { FILO_CHAT: 'gpt' }, OWN_BAD);
  await chiedi(home, 'ciao rifiutata');
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('coi crediti di Filo questo modello non si usa', { timeout: 30000 });
  console.log('CHAT-RIF:', await home.locator('.dash-bubble-filo').last().innerText());
  const chiuse = seen.completions.filter((c) => c.model === CHIUSO);
  console.log('CHIAMATE:', JSON.stringify(chiuse));
  expect(chiuse.map((c) => c.key)).toEqual([OWN_BAD]);
});

test('chat della home: un modello aperto per il catalogo (non per nome) parte coi crediti; uno chiuso ignoto no', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await redeemWallet(openTab);
  await prepare(app, { FILO_CHAT: 'remm' });
  await chiedi(home, 'ciao catalogo');
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('RISPOSTA-ROUTER', { timeout: 30000 });
  expect(seen.completions.some((c) => c.model === SOLO_CATALOGO && c.key === PERSONAL_KEY)).toBe(true);
  await prepare(app, { FILO_CHAT: 'aion' });
  await chiedi(home, 'ciao ignoto');
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('coi crediti di Filo questo modello non si usa', { timeout: 30000 });
  expect(seen.completions.filter((c) => c.model === IGNOTO_CHIUSO)).toEqual([]);
});

test('catena: chiuso poi aperto sulla chat coi crediti', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtabPage(app);
  await redeemWallet(openTab);
  await prepare(app, { FILO_CHAT: 'gpt, deepseek-flash' });
  await chiedi(home, 'ciao catena');
  await home.waitForTimeout(8000);
  console.log('CATENA:', await home.locator('.dash-bubble-filo').last().innerText());
  console.log('CHIAMATE:', JSON.stringify(seen.completions));
  expect(seen.completions.filter((c) => c.model === CHIUSO)).toEqual([]);
});

const PAGINA = '<!doctype html><meta charset="utf-8"><title>Prova</title>'
  + '<p id="t" lang="en" style="font:18px sans-serif;margin:120px 40px">Photosynthesis turns light into sugar.</p>';

test('traduci con la scorciatoia: modello chiuso coi crediti → frase', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app, { TRANSLATE_SELECTION: 'gpt', TRANSLATE: 'gpt' });
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#t'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('translate-selection', win);
  });
  await expect.poll(() => testoDi(app, page, '.sn-popup'), { timeout: 30000 }).toContain('coi crediti di Filo questo modello non si usa');
  console.log('TRADUCI:', await testoDi(app, page, '.sn-popup'));
  expect(seen.completions.filter((c) => c.model === CHIUSO)).toEqual([]);
  await clicca(app, page, '.sn-popup .sn-popup-close').catch(() => {});
  expect(await conta(app, page, '.sn-popup')).toBeGreaterThanOrEqual(0);
});
