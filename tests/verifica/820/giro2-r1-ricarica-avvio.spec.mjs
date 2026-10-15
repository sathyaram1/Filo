// Verifica #820 giro 2: l'avviso all'avvio porta alla ricarica; l'allarme del tetto porta al tetto.

import { createServer } from 'node:http';
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState } from '../../helpers/confirm.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
const GIORNO = 24 * 60 * 60 * 1000;
const fa = (n) => new Date(Date.now() - n * GIORNO).toISOString().slice(0, 10);

const CONTO_SANO = { totalCreditsUsd: 60, totalUsageUsd: 30, readAt: '2026-10-15T08:30:00.000Z' };
const CONTO_CORTO = { totalCreditsUsd: 60, totalUsageUsd: 55.8, readAt: '2026-10-15T08:30:00.000Z' };
const stato = { account: CONTO_SANO, overview: 0 };
let server;

const PERSONE = () => [
  { pseudonym: 'aaaa000000000001', balance: { credits: 4000, creditsGranted: 5000, usageUsd: 1.5 }, invitedBy: 'owner', createdAt: '2026-09-01T08:00:00.000Z',
    usage: { rows: 9, byAction: { chat: 1.5 }, byDay: { [fa(40)]: 0.5, [fa(0)]: 1 } } },
  { pseudonym: 'bbbb000000000002', balance: { credits: 3000, creditsGranted: 3000, usageUsd: 0.25 }, invitedBy: 'owner', createdAt: '2026-09-02T08:00:00.000Z',
    usage: { rows: 2, byAction: { chat: 0.25 }, byDay: { [fa(3)]: 0.25 } } },
  { pseudonym: 'cccc000000000003', balance: { credits: 2000, creditsGranted: 2000, usageUsd: 0.1 }, invitedBy: 'owner', createdAt: '2026-09-03T08:00:00.000Z',
    usage: { rows: 1, byAction: { chat: 0.1 }, byDay: { [fa(20)]: 0.1 } } },
  { pseudonym: 'dddd000000000004', balance: { credits: 1000, creditsGranted: 2000, usageUsd: 0 }, invitedBy: 'owner', createdAt: '2026-09-04T08:00:00.000Z',
    usage: { rows: 0 } },
];

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
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
      if (url === '/accounts:signUp') return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      if (url === '/token') {
        const rt = new URLSearchParams(raw).get('refresh_token');
        if (rt === OWNER_REFRESH) return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: rt, expires_in: '3600', user_id: 'owner-1' });
        return json(res, 200, { id_token: jwt('anon-1'), refresh_token: rt, expires_in: '3600', user_id: 'anon-1' });
      }
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      if (url === '/walletOverview') {
        stato.overview += 1;
        const result = {
          config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurPerCredit: 0.0007, eurUsdAt: '2026-10-15', maxGrantUsd: 50 },
          totals: { users: 4, totalLimitUsd: 10.08, maxGrantUsd: 50, maxGrantCredits: 59523, grantedCredits: 12000, liveCredits: 10000 },
          ownerInvites: [],
          users: PERSONE(),
        };
        if (stato.account !== undefined) result.account = stato.account;
        return json(res, 200, { result });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
  process.env.FILO_ADMIN_EMAILS = OWNER_EMAIL;
});

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT', 'FILO_ADMIN_EMAILS']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => { stato.account = CONTO_SANO; stato.overview = 0; });

async function simulaOwner(app) {
  return app.evaluate(async ({}, o) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const cfg = req('./auth/config');
    const store = req('./auth/token-store');
    const ga = req('./auth/google-auth');
    cfg.secureTokenEndpoint = o.tokenEndpoint;
    store.save({ refreshToken: o.refresh, email: o.email, name: 'Owner di prova', picture: '' });
    ga.restore();
    await ga.getIdToken();
    return ga.isAdmin();
  }, { tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, refresh: OWNER_REFRESH, email: OWNER_EMAIL });
}

async function apriOwner(app, openTab) {
  expect(await simulaOwner(app)).toBe(true);
  const page = await openTab('filo://credits/owner.html');
  await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
  await expect(page.locator('#ownerConto .sn-wallet-numero')).toHaveCount(4, { timeout: 15_000 });
  return page;
}

const riquadro = (page, nome) => page.locator('#ownerNumeri .sn-wallet-numero, #ownerConto .sn-wallet-numero')
  .filter({ has: page.locator('.sn-wallet-numero-nome', { hasText: nome }) });
const righeVisibili = (page) => page.locator('#ownerUsers tbody tr.sn-wallet-user:visible');
const giornoBreve = (g) => new Date(`${g}T00:00:00.000Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });


const CONTO_TETTO = { totalCreditsUsd: 40, totalUsageUsd: 0, readAt: '2026-10-15T08:30:00.000Z' };

async function allarmeAvvio(app, conto) {
  const home = await aspettaFinestra(app, (w) => w.url().startsWith('filo://newtab'), 'la home dell’avvio non è nata');
  await home.waitForFunction(() => window.__filoDashActions && window.__filoDashActions.ricompenseAvvio, null, { timeout: 0 });
  await home.evaluate(() => window.__filoDashActions.allarmeOwnerChiesto());
  stato.account = conto;
  expect(await simulaOwner(app)).toBe(true);
  await home.reload();
  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 20_000 });
  return home;
}

test('r1 l’avviso all’avvio del conto che non regge offre di ricaricarlo, non solo di aprire la pagina', async ({ app }) => {
  const home = await allarmeAvvio(app, CONTO_CORTO);
  const s = await confirmState(home);
  await home.screenshot({ path: 'tests/.shots/verifica-820-avvio.png' });
  expect(`${s.okLabel} | ${s.cancelLabel}`).toMatch(/Ricaric/);
});

test('r1 l’allarme del tetto oltre il caricato porta anche ad abbassare il tetto, come dice', async ({ app, openTab }) => {
  stato.account = CONTO_TETTO;
  const page = await apriOwner(app, openTab);
  const allarme = page.locator('#ownerAllarme');
  await expect(allarme).toBeVisible();
  await expect(allarme).toContainText('Il tetto dei crediti da regalare vale 50,00 $, più dei 40,00 $ caricati');
  await expect(page.locator('#ownerRicarica')).toBeVisible();
  await expect(riquadro(page, 'caricati')).toHaveClass(/is-allarme/);
  await expect(riquadro(page, 'restano sul conto')).not.toHaveClass(/is-allarme/);
  // «abbassa il tetto o ricarica il conto»: anche la prima strada parte dall'allarme.
  await expect(allarme.locator('button, a').filter({ hasText: /tetto/i })).toHaveCount(1);
});
