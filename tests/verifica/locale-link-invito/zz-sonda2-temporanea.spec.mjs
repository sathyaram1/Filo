// SONDA TEMPORANEA 2 del sesto giro — da cancellare.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { confirmText, clickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const CODICE = 'ABCDEFGH';
let server;
let riscattato = false;
const redeems = [];

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
      const auth = req.headers.authorization || '';
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (auth !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/walletState') {
        if (!riscattato) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'ok', code: CODICE } });
      if (url === '/walletRedeem') {
        redeems.push(String((body.data && body.data.code) || ''));
        riscattato = true;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null } });
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

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test('sonda 2: la chiave personale arriva davvero alle impostazioni effettive?', async ({ app }) => {
  test.setTimeout(300000);
  await expect.poll(() => redeems.length, { timeout: 90000, intervals: [400] }).toBeGreaterThan(0);

  let home = null;
  const scad = Date.now() + 30000;
  while (Date.now() < scad && !home) {
    home = app.windows().find((x) => { try { return new URL(x.url()).hostname === 'newtab'; } catch (_) { return false; } }) || null;
    if (!home) await new Promise((r) => setTimeout(r, 150));
  }
  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 90000 });
  await clickConfirm(home, 'ok');
  await new Promise((r) => setTimeout(r, 4000));

  const r = await home.evaluate(async () => {
    const out = {};
    try {
      const rr = await chrome.runtime.sendMessage({ type: 'filo_get_onboarding', peek: true });
      out.onb = { ok: rr?.ok, ready: rr?.ready, done: rr?.onboarding?.done, err: rr?.error };
    } catch (e) { out.onb = 'ERR ' + e.message; }
    try {
      const w = await chrome.runtime.sendMessage({ type: 'wallet_state' });
      out.wallet = { ok: w?.ok, hasPersonalKey: w?.hasPersonalKey, keys: Object.keys(w || {}) };
    } catch (e) { out.wallet = 'ERR ' + e.message; }
    return out;
  });
  console.log('SONDA2:', JSON.stringify(r));

  const s = await app.evaluate(async () => {
    const eff = { };
    const req = (p) => process.mainModule.require(p);
    try {
      eff.personale = req('./src/main/auth/wallet-store').personalKey() ? 'c’è' : '(vuota)';
    } catch (e) { eff.personale = 'ERR ' + e.message; }
    try {
      const h = req('./src/main/services/handlers.js');
      const s2 = await h.getEffectiveSettings();
      eff.provider = s2.provider;
      eff.effOpenrouter = s2.apiKeys?.openrouter ? 'c’è' : '(vuota)';
      eff.chiavi = Object.keys(s2.apiKeys || {});
      eff.useDefault = s2.useDefaultModels;
    } catch (e) { eff.eff = 'ERR ' + e.message; }
    return eff;
  });
  console.log('SONDA2 main:', JSON.stringify(s));
  expect(true).toBe(true);
});
