// Verifica #2067 giro 2, rilievo 1: la segnalazione chiede quanti account anonimi sono senza portafoglio. Il server lo
// conta, la Gestione deve mostrarlo (in un riquadro o nella sua spiegazione). Server e identità su HTTP locale.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { GESTIONE } from '../../helpers/gestione.mjs';

const OWNER_EMAIL = 'owner@prova.test';
const OWNER_REFRESH = 'rt-owner';
const CENSIMENTO = {
  at: '2026-11-15T10:00:00.000Z', completo: true,
  totale: 245_160, anonimi: 245_155, conAccesso: 5, anonimiSenzaPortafoglio: 241_321, maiRientrati: 239_000, cancellabili: 230_000,
  portafogli: 3_834,
  criteri: { etaMinimaGiorni: 14, rientroOre: 1, natiPrimaDi: '2026-11-01T10:00:00.000Z' },
  origine: { giorni: 30, totale: 10, fuori: 1, ultime24h: 1, copertura: 0.5, natiPerOra: { dentro: 1, fuori: 1 }, perWorkflow: { 'suite.yml': 9 }, perGiorno: [] },
  corse: {},
};

let server;
function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
const jwt = (uid, extra = {}) => `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

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
        return json(res, 200, { result: {
          config: { invitesRemaining: 9, entryCredits: 5000, dailyCredits: 100, eurUsd: 1.2, eurPerCredit: 0.0007, eurUsdAt: '2026-10-15', maxGrantUsd: 50 },
          totals: { users: 0, totalLimitUsd: 0, maxGrantUsd: 50, maxGrantCredits: 59523, grantedCredits: 0, liveCredits: 0 },
          ownerInvites: [], users: [],
        } });
      }
      if (url === '/ownerAccountAnonimi') return json(res, 200, { result: { ok: true, censimento: CENSIMENTO, pulizia: null } });
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

test('r1 la Gestione dice quanti account anonimi sono senza portafoglio', async ({ app, openTab }) => {
  const owner = await app.evaluate(async ({}, o) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    req('./auth/config').secureTokenEndpoint = o.tokenEndpoint;
    req('./auth/token-store').save({ refreshToken: o.refresh, email: o.email, name: 'Owner di prova', picture: '' });
    const ga = req('./auth/google-auth');
    ga.restore();
    await ga.getIdToken();
    return ga.isAdmin();
  }, { tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, refresh: OWNER_REFRESH, email: OWNER_EMAIL });
  expect(owner).toBe(true);
  const page = await openTab(`${GESTIONE}#utenti`);
  await expect(page.locator('#ownerAnonimi .sn-wallet-numero').first()).toBeVisible({ timeout: 15_000 });
  const letto = await page.locator('#ownerAnonimi').evaluate((ul) => [ul.textContent,
    ...[...ul.querySelectorAll('[title]')].map((e) => e.getAttribute('title'))].join('\n'));
  expect(letto, 'il numero degli anonimi senza portafoglio non si legge da nessuna parte').toContain('241.321');
});
