// #816 — primo giro, esplorazione: saldo in chat, messaggio d'invio e riquadro della risoluzione
// con un portafoglio finto (server HTTP locale, come crediti-veri-portafoglio.spec).

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
let serverDown = false;
let ritardoStato = 0;
let saldo = 4321.5;
let quota = 100;
let grants = [];

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
      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-816' });
      }
      if (url === '/token') {
        return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-816' });
      }
      if (serverDown) { res.destroy(); return; }
      if (url === '/walletState') {
        if (ritardoStato) await new Promise((r) => setTimeout(r, ritardoStato));
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: saldo, creditsGranted: 5000, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: quota, grants, invites: [],
          },
        });
      }
      if (url === '/walletRedeem') {
        return json(res, 200, {
          result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, inviteCodes: [] },
        });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.beforeEach(() => {
  serverDown = false;
  ritardoStato = 0;
  saldo = 4321.5;
  quota = 100;
  grants = [{ at: '2026-09-20T10:00:00.000Z', credits: 5000, why: 'entry' }];
});

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

async function riscatta(app) {
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: 'wallet_redeem', code: 'ABCD-EFGH' },
    { tab: { id: 8, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' },
  ));
  expect(r.ok, JSON.stringify(r)).toBe(true);
}

function saldoLocale(app) {
  return app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balanceExact);
}

function passaUnMinuto(app) {
  return app.evaluate(() => {
    const vero = globalThis.__dateNowVero || Date.now;
    globalThis.__dateNowVero = vero;
    globalThis.__spostamento = (globalThis.__spostamento || 0) + 61_000;
    Date.now = () => vero() + globalThis.__spostamento;
  });
}

async function homeDiAvvio(app) {
  let win = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

test('chat: quanto aspetta un turno quando il server dei crediti è lento', async ({ app }) => {
  await homeDiAvvio(app);
  await riscatta(app);
  const misura = () => app.evaluate(async () => {
    const t0 = performance.now();
    const { stateText } = await globalThis.SN_FILO_STATE.assemble({ creditiFreschi: true });
    return { ms: Math.round(performance.now() - t0), righe: stateText.split('\n').filter((l) => /Saldo|giorno/.test(l)) };
  });
  const base = await misura();
  console.log('subito dopo il riscatto', JSON.stringify(base));
  ritardoStato = 1500;
  await passaUnMinuto(app);
  const lento = await misura();
  console.log('server a 1,5 s', JSON.stringify(lento));
  ritardoStato = 4000;
  await passaUnMinuto(app);
  const lentissimo = await misura();
  console.log('server a 4 s', JSON.stringify(lentissimo));
  ritardoStato = 0;
  await passaUnMinuto(app);
  // la risposta lenta di prima è arrivata dopo: il turno successivo cosa dice?
  await new Promise((r) => setTimeout(r, 2000));
  const dopo = await misura();
  console.log('dopo', JSON.stringify(dopo));
});

test('invio con allegato non caricato, col portafoglio', async ({ app }) => {
  const page = await homeDiAvvio(app);
  await riscatta(app);
  await app.evaluate(() => {
    globalThis.SN_FEEDBACK.submit = async () => ({ id: 'fbNuovo', failed: [{ name: 'foto.png' }] });
    globalThis.SN_FEEDBACK_OUTBOX._setAuto(false);
  });
  const prima = await saldoLocale(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill('Il tasto indietro non torna alla pagina di prima');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 4_000 });
  const toast = page.locator('.sn-toast').filter({ hasText: 'Feedback inviato' });
  await expect(toast).toBeVisible();
  console.log('toast:', await toast.first().textContent());
  expect(await saldoLocale(app)).toBe(prima);
});

async function semina(app, schede) {
  await app.evaluate(async (_electron, { schede }) => {
    const clientId = 'client-816';
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId, filo_onboarding: { done: true } });
    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const mioHash = await H.hashClientId(clientId);
    const cards = [];
    for (const c of schede) cards.push({ ...c, clientIdTag: await H.cardTag(c._id, mioHash) });
    globalThis.SN_FEEDBACK.listPublic = async () => cards;
    globalThis.SN_FEEDBACK.getManyPublic = async (ids) => {
      const voluti = new Set((ids || []).map(String));
      return cards.filter((c) => voluti.has(String(c._id)));
    };
    await globalThis.SN_FEEDBACK_MINE.scrivi({ ids: schede.map((c) => c._id), checkedAt: 0 });
  }, { schede });
}

test('riquadro: due risolte premiate, una mandata prima del riscatto, tema scuro', async ({ app }) => {
  const page = await homeDiAvvio(app);
  await page.waitForTimeout(500);
  await riscatta(app);
  const prima = await saldoLocale(app);
  const adesso = new Date().toISOString();
  const ieri = new Date(Date.now() - 3 * 24 * 3600e3).toISOString();
  grants = [
    { at: adesso, credits: 50, why: 'feedback_closed:fbA' },
    { at: adesso, credits: 70, why: 'feedback_closed:fbB' },
    ...grants,
  ];
  await semina(app, [
    { _id: 'fbA', status: 'done', statusPublic: 'closed', name: 'Prima cosa', seq: 901, subSeq: 0, userNote: 'Sistemata.', reward: 300, createdAt: adesso, resolvedAt: adesso },
    { _id: 'fbB', status: 'done', statusPublic: 'closed', name: 'Seconda cosa', seq: 902, subSeq: 0, userNote: '', reward: 100, createdAt: adesso, resolvedAt: adesso },
    { _id: 'fbVecchio', status: 'done', statusPublic: 'closed', name: 'Mandata prima', seq: 903, subSeq: 0, userNote: 'Anche questa.', reward: 200, createdAt: ieri, resolvedAt: adesso },
  ]);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#thanksOverlay')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/816-riquadro-scuro.png' }).catch(() => {});
  console.log('voci:', JSON.stringify(await page.locator('.dash-thanks-item').allTextContents()));
  console.log('titolo:', await page.locator('.dash-recap-title').textContent());
  console.log('totale:', await page.locator('.dash-thanks-total').allTextContents());
  expect(await saldoLocale(app)).toBe(prima);
});

test('riquadro: solo archiviata, tema chiaro', async ({ app }) => {
  const page = await homeDiAvvio(app);
  await page.waitForTimeout(500);
  await riscatta(app);
  const adesso = new Date().toISOString();
  await semina(app, [
    { _id: 'fbArch', status: 'archived', statusPublic: 'closed', name: 'Un doppione', seq: 904, subSeq: 0, userNote: '', reward: 50, createdAt: adesso, resolvedAt: adesso },
  ]);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#thanksOverlay')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/816-riquadro-archiviata.png' }).catch(() => {});
  console.log('titolo:', await page.locator('.dash-recap-title').textContent());
  console.log('header:', await page.locator('.dash-thanks-header').textContent());
});
