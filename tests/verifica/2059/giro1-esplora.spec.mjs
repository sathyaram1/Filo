// Verifica #2059, giro 1: la Gestione aperta non rilegge la vista dei consumi a ogni risposta del modello. Qui le
// strade vere del main (risposta buona della chiave propria, anche dopo un rifiuto ricordato) e un regalo dalla
// scheda Utenti: quante walletOverview partono.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { GESTIONE, apriScheda } from '../../helpers/gestione.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
let server;
const conta = { overview: 0 };

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
const PERSONA = 'aaaa000000000001';

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
      if (url === '/walletGrant') return json(res, 200, { result: { ok: true, credits: 10 } });
      if (url === '/walletOverview') {
        conta.overview += 1;
        return json(res, 200, {
          result: {
            config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurUsdAt: '2026-09-10', maxGrantUsd: 50 },
            totals: { users: 1, totalLimitUsd: 4.2, maxGrantUsd: 50 },
            ownerInvites: [],
            users: [{ pseudonym: PERSONA, balance: { credits: 5000, creditsGranted: 5000, usageUsd: 0 }, invitedBy: 'owner', createdAt: '2026-10-01T08:00:00.000Z', usage: { rows: 0 } }],
          },
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
  process.env.FILO_ADMIN_EMAILS = OWNER_EMAIL;
});

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
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function ferme(app) {
  await expect.poll(() => app.evaluate(() => process.uptime()), { timeout: 30_000 }).toBeGreaterThan(9);
  await expect.poll(async () => { const a = conta.overview; await pausa(1500); return conta.overview - a; }, { timeout: 15_000 }).toBe(0);
}
async function apriUtenti(app, openTab) {
  expect(await simulaOwner(app)).toBe(true);
  const page = await openTab(`${GESTIONE}#utenti`);
  await expect(page.locator('#ownerUsers tr.sn-wallet-user')).toHaveCount(1, { timeout: 15_000 });
  await ferme(app);
  return page;
}
// La risposta buona della chiave propria, dalla porta che usa il provider (il main la frena a una ogni 3 s).
const risposteChiavePropria = async (app, n, { rifiuto = false } = {}) => {
  for (let i = 0; i < n; i++) {
    await app.evaluate(async (_, rif) => {
      if (rif) await globalThis.SN_STORAGE.setRaw('walletOwnKeyRefusal', { at: new Date().toISOString(), status: 402, detail: 'x', usedCredits: true });
      await globalThis.SN_WALLET_MAIN.noteOwnKeySuccess();
    }, rifiuto);
    await pausa(3200);
  }
};

test('risposte della chiave propria vere, Utenti davanti e Gestione su un\'altra scheda: nessuna lettura', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await apriUtenti(app, openTab);
  let prima = conta.overview;
  await risposteChiavePropria(app, 3);
  await risposteChiavePropria(app, 2, { rifiuto: true });
  expect(conta.overview - prima).toBe(0);
  await apriScheda(page, 'predefiniti');
  prima = conta.overview;
  await risposteChiavePropria(app, 2);
  await apriScheda(page, 'utenti');
  await pausa(2000);
  expect(conta.overview - prima).toBe(0);
});

test('controllo: un movimento qualunque con Utenti davanti rilegge una volta', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await apriUtenti(app, openTab);
  const prima = conta.overview;
  await app.evaluate(() => { for (let i = 0; i < 5; i++) globalThis.SN_BROADCAST_FILO({ type: globalThis.SN_MSG.MSG.CREDITS_CHANGED }); });
  await pausa(4000);
  expect(conta.overview - prima).toBe(1);
});

test('un regalo dalla scheda Utenti rilegge la vista una volta sola', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await apriUtenti(app, openTab);
  const prima = conta.overview;
  await page.locator('#ownerGrantPseudonym').fill(PERSONA);
  await page.locator('#ownerGrantCredits').fill('10');
  await page.locator('#ownerGrantBtn').click();
  await expect(page.locator('#ownerMsg')).toContainText(`+10 crediti a ${PERSONA}`, { timeout: 15_000 });
  await pausa(4000);
  expect(conta.overview - prima).toBe(1);
});
