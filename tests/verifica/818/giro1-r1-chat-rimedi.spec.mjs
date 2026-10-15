// #818, giro 1: dopo l'avviso in chat l'utente risponde a parole. Filo deve sapere cosa ha proposto e poterlo fare.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const PSEUDONYM = 'abcdef0123456789';
let server;
let base = '';
let redeemed = false;
let saldo = 400;
const richieste = [];

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
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 't', refreshToken: 'r', expiresIn: '3600', localId: 'u818' });
      if (url === '/token') return json(res, 200, { id_token: 't', refresh_token: 'r', expires_in: '3600', user_id: 'u818' });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        const notte = new Date(); notte.setHours(2, 0, 0, 0);
        return json(res, 200, { result: {
          hasWallet: true, pseudonym: PSEUDONYM,
          balance: { credits: saldo, creditsGranted: 2600, eurUsd: 1.2, eurPerCredit: 0.0007 },
          stale: false, dailyCredits: 100, invites: [],
          grants: [{ at: notte.toISOString(), credits: 100, why: 'daily' }, { at: '2026-09-20T10:00:00.000Z', credits: 2000, why: 'entry' }],
        } });
      }
      if (url === '/walletRedeem') {
        redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: PSEUDONYM, credits: 2000, entryCredits: 2000, inviteCodes: [] } });
      }
      if (url === '/api/v1/chat/completions') {
        const msgs = Array.isArray(body.messages) ? body.messages : [];
        if (JSON.stringify(msgs).includes('preparare la dashboard')) { req.socket.destroy(); return; }
        const last = msgs[msgs.length - 1] || {};
        if (body.tools && last.role === 'user') richieste.push(body);
        const testo = 'Ecco fatto.';
        if (body.stream !== true) return json(res, 200, { id: 'g', provider: 'Fake', choices: [{ message: { content: testo }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0 } });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'g', provider: 'Fake', choices: [{ delta: { content: testo } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
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

async function newtab(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('r1 dopo l\'avviso in chat, «sì, usa i modelli più economici» scritto a Filo: Filo sa cosa ha proposto e ha come farlo', async ({ app, shell }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await newtab(app);
  await app.evaluate((_, b) => {
    const vero = globalThis.fetch;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/openrouter\.ai/, b).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
  }, base);
  await app.evaluate(async () => {
    const CA = globalThis.SN_CREDITI_AVVISO;
    const A = globalThis.SN_CONST.ACTIONS;
    let d = {};
    for (let i = 1; i <= 3; i++) {
      const giorno = CA.chiaveGiorno(new Date(Date.now() - i * 86400000));
      d = CA.aggiungi(d, { giorno, azione: A.FILO_CHAT, crediti: 240, prompt: 240000, completion: 24000 });
      d = CA.aggiungi(d, { giorno, azione: A.FILO_TAB_SUMMARY, crediti: 60, prompt: 60000, completion: 6000 });
    }
    await globalThis.SN_AVVISO_CREDITI_MAIN.impostaDiarioPerTest(d);
  });
  saldo = 4000;
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_redeem', code: 'ABCD-EFGH' },
    { tab: { id: 8, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' }));
  expect(r.ok).toBe(true);
  saldo = 400;
  await app.evaluate(() => {
    const vero = Date.now;
    Date.now = () => vero() + 61_000;
  });

  await home.locator('#input').fill('ciao');
  await home.locator('#sendBtn').click();
  const avviso = home.locator('.dash-crediti-avviso');
  await expect(avviso).toHaveCount(1, { timeout: 40_000 });
  await expect(avviso.locator('.sn-crediti-rimedio[data-rimedio="modello"]')).toBeVisible();
  await expect(home.locator('#sendBtn')).toBeEnabled({ timeout: 20_000 });

  const prima = richieste.length;
  await home.locator('#input').fill('sì, usa i modelli più economici');
  await home.locator('#sendBtn').click();
  await expect.poll(() => richieste.length, { timeout: 30_000 }).toBeGreaterThan(prima);
  const body = richieste.at(-1);
  const testo = JSON.stringify(body.messages);
  const strumenti = JSON.stringify(body.tools || []);
  // Filo vede i rimedi che ha appena proposto (non solo «ti restano 400 crediti»)…
  expect(testo).toMatch(/modelli più economici per/);
  // …e ha uno strumento per applicarli e rimetterli com'erano.
  expect(strumenti).toMatch(/credits_remedy|rimedi|modelliScelti/);
});
