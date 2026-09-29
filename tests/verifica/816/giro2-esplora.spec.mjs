// Verifica #816, giro 2: il riquadro della risoluzione col server dei crediti
// muto, l'aspetto nei due temi, e l'invio con un allegato non caricato.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

let server;
let serverDown = false;
let grants = [];

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
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-816' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-816' });
      if (serverDown) { res.destroy(); return; }
      if (url === '/walletState') {
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 4321.5, creditsGranted: 5000, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, grants, invites: [] } });
      }
      if (url === '/walletRedeem') {
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, inviteCodes: [] } });
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

test('server dei crediti muto al controllo: la cifra dai movimenti ricordati, chi non ce l\'ha aspetta', async ({ app }) => {
  const page = await homeDiAvvio(app);
  await page.waitForTimeout(500);
  const adesso = new Date().toISOString();
  grants = [{ at: adesso, credits: 50, why: 'feedback_closed:fbA' }, ...grants];
  await riscatta(app);
  serverDown = true;
  await semina(app, [
    { _id: 'fbA', status: 'done', statusPublic: 'closed', name: 'Il tasto indietro', seq: 901, subSeq: 0, userNote: 'Torna indietro.', reward: 300, createdAt: adesso, resolvedAt: adesso },
    { _id: 'fbB', status: 'done', statusPublic: 'closed', name: 'Il menu che sparisce', seq: 902, subSeq: 0, userNote: 'Resta aperto.', reward: 100, createdAt: adesso, resolvedAt: adesso },
    { _id: 'fbC', status: 'archived', statusPublic: 'closed', name: 'Un doppione', seq: 903, subSeq: 0, userNote: '', reward: 50, createdAt: adesso, resolvedAt: adesso },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#thanksOverlay')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-thanks-item')).toHaveCount(2);
  await expect(page.locator('.dash-thanks-item').filter({ hasText: 'Il tasto indietro' }).locator('.dash-thanks-item-credits')).toHaveText('+50');
  await expect(page.locator('.dash-thanks-item').filter({ hasText: 'Un doppione' }).locator('.dash-thanks-item-credits')).toHaveCount(0);
  await expect(page.locator('.dash-thanks-total')).toContainText('+50 crediti');

  serverDown = false;
  grants = [{ at: new Date().toISOString(), credits: 50, why: 'feedback_closed:fbB' }, ...grants];
  await app.evaluate(async () => globalThis.SN_FEEDBACK_MINE.scrivi({ ids: ['fbA', 'fbB', 'fbC'], checkedAt: 0 }));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#thanksOverlay')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-thanks-item')).toHaveCount(1);
  await expect(page.locator('.dash-thanks-item-credits')).toHaveText('+50');
});

for (const tema of ['light', 'dark']) {
  test(`aspetto del riquadro col portafoglio, tema ${tema}`, async ({ app }) => {
    const page = await homeDiAvvio(app);
    await page.waitForTimeout(500);
    await app.evaluate(async (_e, tema) => { await globalThis.SN_STORAGE.setSettings({ theme: tema }); }, tema);
    await riscatta(app);
    const adesso = new Date().toISOString();
    grants = [{ at: adesso, credits: 50, why: 'feedback_closed:fbL' }, ...grants];
    await semina(app, [
      { _id: 'fbL', status: 'done', statusPublic: 'closed', name: 'Quando chiudo una scheda con tante immagini la finestra si blocca per qualche secondo', seq: 911, subSeq: 0, userNote: 'Adesso la scheda si chiude subito, anche con molte immagini.', reward: 300, createdAt: adesso, resolvedAt: adesso },
      { _id: 'fbM', status: 'archived', statusPublic: 'closed', name: 'Doppione del precedente', seq: 912, subSeq: 0, userNote: '', reward: 50, createdAt: adesso, resolvedAt: adesso },
    ]);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#thanksOverlay')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `tests/.shots/v816-g2-riquadro-${tema}.png` });
    const totale = await page.locator('.dash-thanks-total').boundingBox();
    const x = await page.locator('.dash-recap-x').boundingBox();
    expect(x.x).toBeGreaterThanOrEqual(totale.x + totale.width);
  });
}

test('invio col portafoglio e un allegato non caricato: niente cifra promessa', async ({ app }) => {
  const page = await homeDiAvvio(app);
  await riscatta(app);
  await app.evaluate(() => {
    globalThis.SN_FEEDBACK.submit = async () => ({ id: 'fbX', failed: [{ name: 'foto.png' }] });
    globalThis.SN_FEEDBACK_OUTBOX._setAuto(false);
  });
  const prima = await app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balanceExact);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Il tasto indietro non torna alla pagina di prima');
  await page.locator('.sn-fb-send').click();
  const toast = page.locator('.sn-toast').filter({ hasText: 'Feedback inviato' });
  await expect(toast).toBeVisible({ timeout: 6_000 });
  const testo = await toast.innerText();
  console.log('TOAST:', testo);
  expect(testo).not.toMatch(/\+\d/);
  expect(await app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balanceExact)).toBe(prima);
});

test('senza portafoglio l\'invio resta com\'era: +5 e il conteggio locale sale', async ({ app }) => {
  const page = await homeDiAvvio(app);
  await app.evaluate(() => {
    globalThis.SN_FEEDBACK.submit = async () => ({ id: 'fbY', failed: [] });
    globalThis.SN_FEEDBACK_OUTBOX._setAuto(false);
  });
  const prima = await app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balanceExact);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Il tasto indietro non torna alla pagina di prima');
  await page.locator('.sn-fb-send').click();
  const toast = page.locator('.sn-toast').filter({ hasText: 'Feedback inviato' });
  await expect(toast).toContainText('+5 crediti', { timeout: 6_000 });
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balanceExact)).toBe(prima + 5);
});
