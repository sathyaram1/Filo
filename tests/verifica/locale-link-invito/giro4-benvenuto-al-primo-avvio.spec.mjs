// Giro di verifica locale del ramo claude/link-invito — giro 4.
//
// Il benvenuto della home al primo avvio, con UN SOLO avvio e un server che
// non si porta dietro niente da prove precedenti: è la scena che vede
// l'invitato appena installato Filo. Nessuno scrive niente, e pochi secondi
// dopo l'avvio la home deve dire che si è entrati con un invito e quanti
// crediti ci sono.
//
// Vale come controprova della prova del primo giro, che fa la stessa cosa
// dopo un altro avvio sullo stesso finto server.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { confirmText, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const CODICE = 'ABCDEFGH';

let server;
const visto = { redeems: [] };
let riscattato = false;

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
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100, invites: [{ code: 'AAAA2222', max: 3, used: 0, uses: [] }],
          },
        });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'ok', code: CODICE } });
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        visto.redeems.push(code);
        if (code !== CODICE) return json(res, 200, { result: { status: 'invalid_code' } });
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

test('al primo avvio la home dice da sola che si è entrati con un invito', async ({ app }) => {
  test.setTimeout(180000);
  await expect.poll(() => visto.redeems.length, { timeout: 60000, intervals: [500] }).toBeGreaterThan(0);
  expect(visto.redeems[0]).toBe(CODICE);

  let home = null;
  const scadenza = Date.now() + 30000;
  while (Date.now() < scadenza && !home) {
    home = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; }
    }) || null;
    if (!home) await new Promise((r) => setTimeout(r, 200));
  }
  expect(home, 'la home non si è aperta all’avvio').toBeTruthy();
  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 60000 });
  await expect.poll(() => confirmText(home), { timeout: 20000 }).toContain('Benvenuto in Filo');
  await expect.poll(() => confirmText(home)).toContain('Sei entrato con un invito');
});
