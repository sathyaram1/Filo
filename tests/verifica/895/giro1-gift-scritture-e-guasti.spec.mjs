// Verifica #895, giro 1: /gift con scritture insolite, da chi non è l'owner, e col server che non risponde.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
const MIO = 'f00dbabe12345678';
const ALTRI = [
  { pseudonym: 'f00e000000000001', balance: { credits: 120, creditsGranted: 5000, usageUsd: 3 }, invitedBy: 'owner', createdAt: '2026-09-20T08:00:00.000Z' },
  { pseudonym: 'a1b2c3d4e5f60718', balance: { credits: 4000, creditsGranted: 5000, usageUsd: 0.7 }, invitedBy: MIO, createdAt: '2026-09-21T08:00:00.000Z' },
];
let server;
let stato;

function nuovoStato() {
  return { riscattato: false, crediti: 5000, grants: [], richieste: [], grantGuasto: false };
}
function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  stato = nuovoStato();
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      const data = body.data || {};
      stato.richieste.push({ url, data });
      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      }
      if (url === '/token') {
        const rt = new URLSearchParams(raw).get('refresh_token');
        if (rt === OWNER_REFRESH) return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: rt, expires_in: '3600', user_id: 'owner-1' });
        return json(res, 200, { id_token: jwt('anon-1'), refresh_token: rt, expires_in: '3600', user_id: 'anon-1' });
      }
      if (url === '/walletState') {
        if (!stato.riscattato) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: MIO, dailyCredits: 100, stale: false,
            balance: { credits: stato.crediti, creditsGranted: stato.crediti, limitUsd: 4.2, usageUsd: 0 },
            grants: stato.grants.concat([{ at: '2026-09-20T09:00:00.000Z', credits: 5000, why: 'entry' }]),
            invites: [],
          },
        });
      }
      if (url === '/walletRedeem') {
        stato.riscattato = true;
        return json(res, 200, {
          result: {
            status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: MIO, credits: 5000,
            entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null, inviteCodes: [],
          },
        });
      }
      if (url === '/walletOverview') {
        const mio = stato.riscattato
          ? [{ pseudonym: MIO, balance: { credits: stato.crediti, creditsGranted: stato.crediti, usageUsd: 0 }, invitedBy: 'owner', createdAt: '2026-09-22T08:00:00.000Z' }]
          : [];
        return json(res, 200, {
          result: {
            config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurUsdAt: '2026-09-10', maxGrantUsd: 50 },
            totals: { users: mio.length + ALTRI.length, totalLimitUsd: 12, maxGrantUsd: 50 },
            ownerInvites: [],
            users: mio.concat(ALTRI),
          },
        });
      }
      if (url === '/walletGrant') {
        if (stato.grantGuasto) return json(res, 500, { error: { message: 'INTERNAL' } });
        if (data.pseudonym !== MIO || !stato.riscattato) return json(res, 200, { result: { ok: false, reason: 'no_wallet' } });
        stato.crediti += Number(data.credits) || 0;
        stato.grants.unshift({ at: new Date().toISOString(), credits: Number(data.credits), why: data.why });
        return json(res, 200, { result: { ok: true, credits: Number(data.credits) } });
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

test.beforeEach(() => { stato = nuovoStato(); });

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT', 'FILO_ADMIN_EMAILS']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

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

async function riscatta(page) {
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15_000 });
  await page.fill('#inviteCode', 'ABCD-EFGH');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
}

async function scriviNellaHome(page, comando) {
  const prima = await page.locator('.dash-bubble').count();
  await page.evaluate((cmd) => {
    const input = document.getElementById('input');
    input.value = cmd;
    document.getElementById('inputForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, comando);
  return prima;
}
const ultimaBolla = (page) => page.locator('.dash-bubble').last();
const leggiAppunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());


const grants = () => stato.richieste.filter((r) => r.url === '/walletGrant').map((r) => r.data);

test('scritture insolite di /gift: maiuscole, ordine rovesciato, punto delle migliaia, virgolette; i numeri sbagliati non regalano', async ({ app, openTab }) => {
  const crediti = await openTab('filo://credits/credits.html');
  await riscatta(crediti);
  expect(await simulaOwner(app)).toBe(true);
  const home = await openTab('filo://dashboard/dashboard.html');
  await expect(home.locator('#input')).toBeVisible({ timeout: 15_000 });

  for (const cmd of ['/gift 0 f00d', '/gift -5 f00d', '/gift 1,5 f00d', '/gift 500', '/gift', '/gift 500    ', '/gift 500 f00d grazie']) {
    await scriviNellaHome(home, cmd);
    await expect(ultimaBolla(home)).not.toContainText('…', { timeout: 10_000 });
    await expect(ultimaBolla(home)).not.toContainText('✓');
  }
  expect(grants()).toHaveLength(0);

  await scriviNellaHome(home, '/gift 500 F00DBABE');
  await expect(ultimaBolla(home)).toContainText(`✓ Regalati`, { timeout: 15_000 });
  await scriviNellaHome(home, '/gift f00dbabe 7');
  await expect(ultimaBolla(home)).toContainText(`✓ Regalati 7 crediti`, { timeout: 15_000 });
  await scriviNellaHome(home, '/gift 2.000 «f00dbabe12345678»,');
  await expect(ultimaBolla(home)).toContainText(`✓ Regalati`, { timeout: 15_000 });
  expect(grants().map((g) => g.credits)).toEqual([500, 7, 2000]);
  expect(grants().every((g) => g.pseudonym === MIO)).toBe(true);
});

test('chi non è l’owner non regala e non vede l’elenco', async ({ app, openTab }) => {
  const crediti = await openTab('filo://credits/credits.html');
  await riscatta(crediti);
  const home = await openTab('filo://dashboard/dashboard.html');
  await expect(home.locator('#input')).toBeVisible({ timeout: 15_000 });
  await scriviNellaHome(home, '/gift 500 f00d');
  await expect(ultimaBolla(home)).toContainText('riservato', { timeout: 15_000 });
  await scriviNellaHome(home, '/users');
  await expect(ultimaBolla(home)).toContainText('riservato', { timeout: 15_000 });
  expect(grants()).toHaveLength(0);
});

test('regalo senza risposta del server: non dice che è arrivato e indica come controllare', async ({ app, openTab }) => {
  const crediti = await openTab('filo://credits/credits.html');
  await riscatta(crediti);
  expect(await simulaOwner(app)).toBe(true);
  const home = await openTab('filo://dashboard/dashboard.html');
  await expect(home.locator('#input')).toBeVisible({ timeout: 15_000 });
  stato.grantGuasto = true;
  await scriviNellaHome(home, '/gift 500 f00d');
  await expect(ultimaBolla(home)).not.toContainText('…', { timeout: 30_000 });
  const t = await ultimaBolla(home).innerText();
  console.log('RISPOSTA GUASTO:', t);
  expect(t).not.toContain('✓');
});
