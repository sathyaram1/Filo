// La pagina «Inviti e utenti» (#598, solo owner): i due moduli rifiutano con
// una frase di Filo i numeri che non vanno (zero codici, crediti con la
// virgola, pseudonimo vuoto) invece di lasciare parlare la bolla del browser,
// e la riga dei totali conta al singolare quando l'utente è uno.
//
// Server dei crediti e identità sono un HTTP locale, come in
// wallet-credits.spec.mjs; l'accesso dell'owner si simula scrivendo la sua
// sessione nel deposito cifrato dell'app, col rinnovo del token che risponde
// con l'email dell'owner (in FILO_ADMIN_EMAILS).

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
let server;
const seen = { invites: [], grants: [] };

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
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      }
      if (url === '/token') {
        const p = new URLSearchParams(raw);
        const rt = p.get('refresh_token');
        if (rt === OWNER_REFRESH) return json(res, 200, { id_token: jwt('owner-1', { email: OWNER_EMAIL }), refresh_token: rt, expires_in: '3600', user_id: 'owner-1' });
        return json(res, 200, { id_token: jwt('anon-1'), refresh_token: rt, expires_in: '3600', user_id: 'anon-1' });
      }
      if (url === '/walletState') return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
      if (url === '/walletOverview') {
        return json(res, 200, {
          result: {
            config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurUsdAt: '2026-09-10', maxGrantUsd: 50 },
            totals: { users: 1, totalLimitUsd: 4.2, maxGrantUsd: 50 },
            ownerInvites: [],
            users: [{ pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, usageUsd: 0 }, invitedBy: 'owner', createdAt: '2026-09-10T08:00:00.000Z', usage: { rows: 0 } }],
          },
        });
      }
      if (url === '/walletCreateInvites') {
        seen.invites.push(body.data);
        const n = Number(body.data && body.data.count) || 0;
        return json(res, 200, { result: { codes: Array.from({ length: n }, (_, i) => `CODE-${String(i).padStart(4, '0')}`) } });
      }
      if (url === '/walletGrant') {
        seen.grants.push(body.data);
        return json(res, 200, { result: { ok: true, credits: Number(body.data && body.data.credits) || 0 } });
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

test('i moduli dell’owner rifiutano con parole di Filo zero codici, crediti con la virgola e pseudonimo vuoto; un utente si conta al singolare', async ({ app, openTab }) => {
  expect(await simulaOwner(app)).toBe(true);
  const page = await openTab('filo://credits/owner.html');
  await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
  await expect(page.locator('#ownerTotals')).toContainText('1 utente ·', { timeout: 15_000 });
  await expect(page.locator('#ownerTotals')).not.toContainText('1 utenti');

  const msg = page.locator('#ownerMsg');

  // Zero codici: frase di Filo, fuoco sul campo, nessuna richiesta al server.
  await page.fill('#ownerInviteCount', '0');
  await page.click('#ownerInvitesBtn');
  await expect(msg).toBeVisible();
  await expect(msg).toHaveText('Quanti codici? Un numero da 1 a 200.');
  await expect(msg).toHaveClass(/is-error/);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('ownerInviteCount');
  expect(seen.invites.length).toBe(0);

  // Con 2 la richiesta parte e i codici compaiono: il rifiuto di prima non ha rotto il modulo.
  await page.fill('#ownerInviteCount', '2');
  await page.click('#ownerInvitesBtn');
  await expect(msg).toContainText('2 codici nuovi', { timeout: 15_000 });
  await expect(page.locator('#ownerCodes li')).toHaveCount(2);
  expect(seen.invites).toEqual([{ count: 2 }]);

  // Regalo senza pseudonimo: lo dice.
  await page.fill('#ownerGrantPseudonym', '');
  await page.fill('#ownerGrantCredits', '10');
  await page.click('#ownerGrantBtn');
  await expect(msg).toContainText('Serve lo pseudonimo');
  expect(seen.grants.length).toBe(0);

  // Crediti con la virgola: non si arrotonda in silenzio, si chiede un intero.
  await page.fill('#ownerGrantPseudonym', 'abcdef0123456789');
  await page.fill('#ownerGrantCredits', '10.7');
  await page.click('#ownerGrantBtn');
  await expect(msg).toHaveText('Quanti crediti? Un numero intero, almeno 1.');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('ownerGrantCredits');
  expect(seen.grants.length).toBe(0);

  // Con un intero il regalo parte e la conferma arriva.
  await page.fill('#ownerGrantCredits', '10');
  await page.click('#ownerGrantBtn');
  await expect(msg).toContainText('+10 crediti a abcdef0123456789', { timeout: 15_000 });
  expect(seen.grants).toEqual([{ pseudonym: 'abcdef0123456789', credits: 10, why: 'owner' }]);
});
