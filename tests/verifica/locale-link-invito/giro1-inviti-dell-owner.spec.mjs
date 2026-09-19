// Giro di verifica locale del ramo claude/link-invito — giro 1.
//
// «Chi l'ha generato vede quante sono entrate.» Chi genera gli inviti di Filo
// è chi lo gestisce, nella pagina «Inviti e utenti»: è da lì che escono i
// codici da dare ai primi invitati. Qui si guarda quella pagina con un invito
// che ha un posto occupato su tre.
//
// Server finto, come negli altri spec dei crediti; l'accesso di chi gestisce
// Filo si simula scrivendo la sua sessione nel deposito dell'app.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
let server;

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
            ownerInvites: [
              // Un invito da tre posti con UNO occupato: restano due persone
              // da invitare con lo stesso link.
              { code: 'AAAA2222', max: 3, used: 1, uses: [{ pseudonym: 'fedebb00', at: '2026-09-17T10:00:00.000Z' }], createdAt: '2026-09-10T09:00:00.000Z' },
              { code: 'BBBB3333', max: 3, used: 0, uses: [], createdAt: '2026-09-10T09:00:00.000Z' },
            ],
            users: [{ pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, usageUsd: 0 }, invitedBy: 'owner', createdAt: '2026-09-10T08:00:00.000Z', usage: { rows: 0 } }],
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

test('chi genera gli inviti vede il link e quanti sono entrati, e un invito con posti liberi resta da dare', async ({ app, openTab }) => {
  expect(await simulaOwner(app)).toBe(true);
  const page = await openTab('filo://credits/owner.html');
  await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 20000 });
  const righe = page.locator('#ownerCodes > li');
  await expect(righe).toHaveCount(2, { timeout: 20000 });

  const conUnPosto = page.locator('#ownerCodes > li[data-code="AAAA2222"], #ownerCodes > li[data-code="AAAA-2222"]').first();

  // Un posto su tre occupato: restano due persone da invitare, quindi
  // l'invito NON è finito e si deve poter ancora dare.
  await expect(conUnPosto).not.toHaveClass(/is-used/);
  await expect(conUnPosto.locator('.sn-wallet-invite-state')).toHaveText('entrati 1 su 3');
  await expect(conUnPosto.locator('.sn-wallet-code')).toBeEnabled();

  // E quello che si dà è un link, come per chiunque altro.
  await expect(conUnPosto.locator('.sn-wallet-invite-link')).toHaveText('https://filo.red/i/AAAA2222');
});
