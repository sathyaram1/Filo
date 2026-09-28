// Server dei crediti e di Firestore finto, e i passi comuni delle prove del giro home-invito.
// Non è uno spec: lo importano gli spec della cartella.
import { createServer } from 'node:http';
import { expect } from '../../fixtures/electron.mjs';

const PERSONAL = 'sk-or-v1-test-personal';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function usaServerFinto(test) {
  const stato = { base: '', redeemed: false, pendingCode: null, modelsDoc: null, trattieni: false, trattenute: [] };
  let server;
  test.beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const url = req.url.split('?')[0];
        if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
        if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
        if (url.includes('/documents/config/models')) return stato.modelsDoc ? json(res, 200, stato.modelsDoc) : json(res, 404, {});
        if (url.includes('/documents/')) return json(res, 404, {});
        if (url === '/walletState') {
          if (!stato.redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
          return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
        }
        if (url === '/walletPendingInvite') {
          const rispondi = () => json(res, 200, { result: stato.pendingCode && !stato.redeemed ? { status: 'ok', code: stato.pendingCode } : { status: 'none' } });
          if (stato.trattieni) { stato.trattenute.push(rispondi); return undefined; }
          return rispondi();
        }
        if (url === '/walletRedeem') {
          stato.redeemed = true;
          return json(res, 200, { result: { status: 'ok', key: PERSONAL, pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } });
        }
        return json(res, 404, { error: { message: 'not found ' + url } });
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    stato.base = `http://127.0.0.1:${server.address().port}`;
    process.env.FILO_FUNCTIONS_BASE = stato.base;
    process.env.FILO_IDENTITY_ENDPOINT = `${stato.base}/accounts:signUp`;
    process.env.FILO_SECURE_TOKEN_ENDPOINT = `${stato.base}/token`;
  });
  test.afterAll(async () => {
    delete process.env.FILO_FUNCTIONS_BASE;
    delete process.env.FILO_IDENTITY_ENDPOINT;
    delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
    await new Promise((r) => server.close(r));
  });
  test.beforeEach(() => {
    stato.redeemed = false;
    stato.pendingCode = null;
    stato.modelsDoc = null;
    stato.trattieni = false;
    stato.trattenute.length = 0;
  });
  return stato;
}

export async function homePage(app) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded').catch(() => {}); return w; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('home non trovata');
}

// `openTab` cerca la scheda per nome dell'host e ridarebbe la home già aperta.
export async function nuovaHome(app, shell) {
  const prima = new Set(app.windows());
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const w = app.windows().find((x) => !prima.has(x) && x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded').catch(() => {}); return w; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('scheda nuova non trovata');
}

// Modelli finti nel main (la home generata si riconosce dal testo), Firestore girato sul finto.
export async function prepara(app, base) {
  await app.evaluate((_, b) => {
    if (!globalThis.__filoFetchVero) {
      const vero = globalThis.fetch;
      globalThis.__filoFetchVero = vero;
      globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
    }
    const P = globalThis.SN_PROVIDERS;
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'HOME-DAL-MODELLO: ciao di nuovo.', suggestions: [] });
      return JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const text = reply(messages);
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => {
      const text = reply(messages);
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, base);
}

export async function onboardingFatto(app) {
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const cur = await M.getOnboarding();
    await M.setOnboarding({ ...cur, done: true });
  });
}

export async function riscattaDaCrediti(openTab) {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 20_000 });
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 20_000 });
  return page;
}

export const testoHome = (home) => home.evaluate(() => `${document.getElementById('homeMessage')?.innerText || ''}\n${document.getElementById('suggestions')?.innerText || ''}`);
