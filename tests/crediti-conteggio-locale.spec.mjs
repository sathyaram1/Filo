// #1353 — il conteggio locale (crediti di prova tenuti sul computer) non si spaccia per soldi dell'utente:
// con la chiave propria la pagina Crediti e la chat dicono che le richieste le paga la chiave, e al riscatto chi
// vedeva quel numero, con la chiave propria o con quella di fabbrica, legge che lascia il posto ai crediti d'ingresso.
//
// Server dei crediti, identità e OpenRouter sono un HTTP locale (come ripiego-crediti.spec): le variabili vanno
// nell'ambiente prima che la fixture lanci Electron, e nel main `fetch` manda openrouter.ai qui.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

const OWN_KEY = 'sk-or-v1-own-key-1353';
const FACTORY_KEY = 'sk-or-v1-fabbrica-1353';
const FRASE = 'Prendono il posto dei crediti di prova che Filo teneva su questo computer.';

let server;
let base = '';
let redeemed = false;
let ritardoMs = 0;
const prompt = [];

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
      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1353' });
      }
      if (url === '/token') {
        return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1353' });
      }
      if (url === '/walletState') {
        if (!redeemed) { setTimeout(() => json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } }), ritardoMs); return; }
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 5000, creditsGranted: 5000, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100, grants: [{ at: '2026-10-20T10:00:00.000Z', credits: 5000, why: 'entry' }], invites: [],
          },
        });
      }
      if (url === '/walletRedeem') {
        redeemed = true;
        return json(res, 200, {
          result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] },
        });
      }
      if (url === '/api/v1/auth/key') {
        return json(res, 200, { data: { label: 'la mia', limit: 10, usage: 1.5, limit_remaining: 8.5 } });
      }
      if (url === '/api/v1/chat/completions') {
        const testo = JSON.stringify(body.messages || []);
        if (testo.includes('preparare la dashboard')) { req.socket.destroy(); return; }
        if (Array.isArray(body.tools) && body.tools.length) prompt.push(testo);
        if (body.stream !== true) {
          return json(res, 200, { id: 'gen-1', provider: 'Fake', choices: [{ message: { content: 'Va bene.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0001 } });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'gen-1', provider: 'Fake', choices: [{ delta: { content: 'Paga la tua chiave.' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0001 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
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
  redeemed = false;
  ritardoMs = 0;
  prompt.length = 0;
});

async function versoIlFinto(app) {
  await app.evaluate((_, b) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/openrouter\.ai/, b), init);
  }, base);
}

async function homeDiAvvio(app) {
  let win = null;
  await expect.poll(() => Boolean(win = app.windows().find((w) => w.url().startsWith('filo://newtab'))), { timeout: 15_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#input')).toBeVisible();
  return win;
}

async function riscattaDallaPagina(page) {
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15_000 });
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10_000 });
}

test('chiave propria: Crediti e chat dicono che paga la chiave e che il conteggio non sono soldi suoi; al riscatto la frase c\'è', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const home = await homeDiAvvio(app);
  await versoIlFinto(app);
  await app.evaluate(async (_, k) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: k },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  }, OWN_KEY);
  const locale = await app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balance);

  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#hero')).toBeVisible({ timeout: 15_000 });
  const riga = page.locator('#refillHint');
  await expect(riga).toBeVisible();
  await expect(riga).toContainText('Le richieste le paga la tua chiave OpenRouter.');
  await expect(riga).toContainText('crediti di prova che Filo tiene su questo computer, non soldi che spendi');
  await expect(riga).toContainText('ogni giorno a mezzanotte');
  await page.screenshot({ path: 'tests/.shots/1353-crediti-chiave-propria.png' });

  // La chat: il prompt che arriva al modello col turno dice chi paga, e il conteggio non è il saldo.
  await home.bringToFront().catch(() => {});
  await home.locator('#input').fill('quanti crediti ho?');
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo').last()).toContainText('Paga la tua chiave.', { timeout: 30_000 });
  const turno = prompt.find((p) => p.includes('quanti crediti ho?'));
  expect(turno, 'il turno di chat è arrivato al modello').toBeTruthy();
  expect(turno).toContain('le richieste le paga quella chiave');
  expect(turno).toContain(`crediti di prova su questo computer: ${locale}`);
  expect(turno).toContain('Non sono soldi che l\'utente spende e non sono il suo saldo');
  expect(turno).not.toMatch(/Saldo: \d+ crediti \(si ricaricano/);

  // Riscatto: la conferma dice dove va il conteggio che era a schermo, senza contarlo.
  await page.bringToFront().catch(() => {});
  await riscattaDallaPagina(page);
  await expect(page.locator('#redeemMsg')).toHaveText(`Invito riscattato: hai 5.000 crediti d’ingresso. ${FRASE}`);
  await expect(page.locator('#walletNote')).toHaveText(`Invito riscattato: hai 5.000 crediti d’ingresso. ${FRASE}`);
  await expect(page.locator('#balance')).toHaveText('5.000', { timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/1353-riscatto-chiave-propria.png' });
});

// La pagina si ridisegna a ogni chiamata pagata con la chiave: mentre rilegge, la riga resta quella della chiave propria.
test('chiave propria: mentre la pagina Crediti rilegge lo stato, la riga sotto il conteggio non torna quella di serie', async ({ app, openTab }) => {
  await app.evaluate(async (_, k) => { await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: k } }); }, OWN_KEY);
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#refillHint')).toContainText('Le richieste le paga la tua chiave OpenRouter.', { timeout: 15_000 });
  await page.evaluate(() => {
    window.__righe = [];
    const el = document.getElementById('refillHint');
    new MutationObserver(() => window.__righe.push(el.hidden ? '(nascosta)' : el.textContent))
      .observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
  });
  ritardoMs = 1_500;
  await app.evaluate(() => globalThis.SN_BROADCAST_FILO({ type: globalThis.SN_MSG.MSG.CREDITS_CHANGED, ownKeyUsed: true }));
  await page.waitForTimeout(2_500);
  const righe = await page.evaluate(() => window.__righe);
  expect(righe.length, 'la pagina si è ridisegnata').toBeGreaterThan(0);
  for (const t of righe) expect(t).toContain('Le richieste le paga la tua chiave OpenRouter.');
});

test.describe('chiave di fabbrica', () => {
  test.beforeAll(() => { process.env.FILO_DEFAULT_OPENROUTER_KEY = FACTORY_KEY; });
  test.afterAll(() => { delete process.env.FILO_DEFAULT_OPENROUTER_KEY; });

  test('il conteggio resta il saldo di prova; il riscatto dalla pagina dice dove va', async ({ app, openTab }) => {
    await versoIlFinto(app);
    expect(await app.evaluate(() => globalThis.SN_WALLET_MAIN.keySource())).toBe('factory');
    const page = await openTab('filo://credits/credits.html');
    await expect(page.locator('#hero')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#refillHint')).toHaveText(/^Ricevi \+\d+ crediti ogni giorno a mezzanotte\.$/);
    await riscattaDallaPagina(page);
    await expect(page.locator('#redeemMsg')).toHaveText(`Invito riscattato: hai 5.000 crediti d’ingresso. ${FRASE}`);
  });

  test('l\'invito arrivato da un link: il benvenuto nella pagina Crediti dice dove va il conteggio', async ({ app, openTab }) => {
    await versoIlFinto(app);
    const out = await app.evaluate(() => globalThis.SN_WALLET_MAIN.redeemFromInvite('ABCD-EFGH'));
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const page = await openTab('filo://credits/credits.html');
    await expect(page.locator('#walletNote')).toHaveText(`Sei entrato con un invito: hai 5.000 crediti. ${FRASE}`, { timeout: 15_000 });
  });
});
