// Verifica #830 giro 6, rilievo 1: il «Prova» premuto nelle Opzioni, con i crediti di Filo e nessuna chiave propria.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const PERSONAL_KEY = 'sk-or-v1-test-personal';
const OWN_BAD = 'sk-or-v1-own-rifiutata';
const CHIUSO = 'openai/gpt-5';

let server;
let base = '';
const seen = { completions: [] };
let redeemed = false;

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
      if (url === '/api/v1/chat/completions') {
        seen.completions.push({ key: bearer, model: body.model });
        if (body.stream !== true) {
          return json(res, 200, { id: 'gen-1', provider: 'Fake', choices: [{ message: { content: 'RISPOSTA-ROUTER.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.0002 } });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'gen-1', provider: 'Fake', choices: [{ delta: { content: 'RISPOSTA-ROUTER.' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.0002 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (url === '/api/v1/generation') return json(res, 404, { error: { message: 'not yet' } });
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

test.beforeEach(() => { seen.completions.length = 0; redeemed = false; });

async function redirectHosts(app) {
  await app.evaluate((_, b) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/openrouter\.ai/, b).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
  }, base);
}

async function prepare(app, chatRef, ownKey = '') {
  await redirectHosts(app);
  await app.evaluate(async (_, { ref, chiuso, own }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: own },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: ref, [C.ACTIONS.TRANSLATE_SELECTION]: ref },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, gpt: { provider: 'openrouter', model: chiuso } },
    });
  }, { ref: chatRef, chiuso: CHIUSO, own: ownKey });
}

async function redeemWallet(openTab) {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await page.fill('#inviteCode', 'abcd-efgh');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
  return page;
}

// Preme il «Prova» della riga col modello `id` e torna il testo che la riga mostra quando la prova è finita.
async function provaRiga(page, id) {
  await page.waitForFunction((m) => [...document.querySelectorAll('#modelRegistryList .sn-model-id')].some((i) => i.value === m), id, { timeout: 10_000 });
  await page.evaluate((m) => {
    document.querySelectorAll('[data-sonda]').forEach((r) => r.removeAttribute('data-sonda'));
    const input = [...document.querySelectorAll('#modelRegistryList .sn-model-id')].find((i) => i.value === m);
    input.closest('.sn-model-row').dataset.sonda = '1';
  }, id);
  const riga = page.locator('#modelRegistryList .sn-model-row[data-sonda="1"]');
  await riga.locator('.sn-model-test').click();
  const stato = riga.locator('.sn-model-row-status');
  await expect.poll(async () => (await stato.textContent()) || '', { timeout: 20_000 }).not.toMatch(/in corso|^\s*$/i);
  return { riga, testo: (await stato.textContent()) || '' };
}

test('r1 il «Prova» delle Opzioni, pagato coi crediti: sul modello chiuso la frase dei crediti, su quello aperto la prova riesce', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app, 'deepseek-flash');
  const page = await openTab('filo://options/options.html');
  const chiuso = await provaRiga(page, CHIUSO);
  await chiuso.riga.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/830-g6-prova.png' }).catch(() => {});
  expect(chiuso.testo).toContain(`non può usare «${CHIUSO}» perché coi crediti di Filo questo modello non si usa`);
  expect(seen.completions.filter((c) => c.model === CHIUSO)).toEqual([]);

  const aperto = await app.evaluate(() => globalThis.SN_TEST_MODELS.registry['deepseek-flash'].model);
  const esito = await provaRiga(page, aperto);
  expect(esito.testo).not.toContain('Manca la API key');
  expect(seen.completions.some((c) => c.key === PERSONAL_KEY && c.model === aperto)).toBe(true);
});
