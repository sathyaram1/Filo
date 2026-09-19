// Giro di verifica locale del ramo claude/link-invito — giro 5.
//
// L'altra metà della stessa scena: il primo avvio di un'installazione nuova
// con un invito che aspetta quella macchina, ma col server LENTO — la home è
// già aperta e ferma da un pezzo quando il riscatto si chiude. Il quarto giro
// aveva visto il benvenuto arrivare solo in questo caso; adesso deve arrivare
// in tutti e due, e questo è quello che non deve essersi rotto correggendo
// l'altro.
//
// Scritto da chi verifica, non da chi ha fatto il lavoro. Server finto: un
// codice vero a usi contati non si brucia per una prova.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { confirmText, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const CODICE = 'ABCDEFGH';
const RITARDO_MS = 12000;

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
        // Il server che ci mette una decina di secondi: la home nel frattempo
        // si è aperta e sta ferma.
        setTimeout(() => {
          if (code !== CODICE) return json(res, 200, { result: { status: 'invalid_code' } });
          riscattato = true;
          json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null } });
        }, RITARDO_MS);
        return;
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

test('col server lento il benvenuto arriva lo stesso, sulla home già aperta', async ({ app }) => {
  test.setTimeout(240000);

  let home = null;
  const scadenza = Date.now() + 40000;
  while (Date.now() < scadenza && !home) {
    home = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; }
    }) || null;
    if (!home) await new Promise((r) => setTimeout(r, 150));
  }
  expect(home, 'la home non si è aperta all’avvio').toBeTruthy();

  await expect.poll(() => visto.redeems.length, { timeout: 90000, intervals: [400] }).toBeGreaterThan(0);
  expect(visto.redeems[0]).toBe(CODICE);

  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 120000 });
  await expect.poll(() => confirmText(home), { timeout: 30000 }).toContain('Benvenuto in Filo');
  expect(await confirmText(home)).toContain('Sei entrato con un invito');
});
