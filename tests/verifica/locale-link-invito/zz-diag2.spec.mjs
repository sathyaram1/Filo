// DIAGNOSTICA TEMPORANEA del giro 4 — da cancellare.
// Stesso primo avvio, ma il riscatto arriva TARDI (il finto server risponde
// dopo dodici secondi): a quel punto la home è viva e caricata da un pezzo.
// Se il benvenuto compare adesso e non quando il riscatto è rapido, la corsa
// è fra l'avviso e la home che si sta ancora aprendo.

import { createServer } from 'node:http';
import { test } from '../../fixtures/electron.mjs';

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
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [{ code: 'AAAA2222', max: 3, used: 0, uses: [] }] } });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'ok', code: CODICE } });
      if (url === '/walletRedeem') {
        // La risposta arriva tardi: la home ha avuto tutto il tempo di aprirsi.
        setTimeout(() => {
          visto.redeems.push(String((body.data && body.data.code) || ''));
          riscattato = true;
          json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null } });
        }, 12000);
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

test('diagnostica: riscatto tardivo, la home lo dice?', async ({ app }) => {
  test.setTimeout(180000);
  for (let i = 0; i < 80 && !visto.redeems.length; i++) await new Promise((r) => setTimeout(r, 500));
  console.log('[diag2] riscatti:', JSON.stringify(visto));
  await new Promise((r) => setTimeout(r, 10000));
  const home = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; } });
  if (!home) { console.log('[diag2] nessuna home'); return; }
  const info = await home.evaluate(() => ({
    host: Boolean(document.querySelector('.sn-confirm-host')),
    stato: (window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test && window.SN_CONFIRM_UI._test.state()) || null,
    testo: (document.body.innerText || '').slice(0, 500),
  })).catch((e) => ({ errore: String(e) }));
  console.log('[diag2] home:', JSON.stringify(info, null, 1));
});
