// DIAGNOSTICA TEMPORANEA del giro 4 — da cancellare. Non asserisce niente:
// guarda solo cosa c'è nella home e nella pagina Crediti dopo il riscatto
// automatico del primo avvio.

import { createServer } from 'node:http';
import { test } from '../../fixtures/electron.mjs';

const CODICE = 'ABCDEFGH';
let server;
const visto = { redeems: [], pending: 0, states: 0 };
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
        visto.states += 1;
        if (!riscattato) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [{ code: 'AAAA2222', max: 3, used: 0, uses: [] }] } });
      }
      if (url === '/walletPendingInvite') { visto.pending += 1; return json(res, 200, { result: { status: 'ok', code: CODICE } }); }
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        visto.redeems.push(code);
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

test('diagnostica: cosa c’è nella home dopo il riscatto automatico', async ({ app }) => {
  test.setTimeout(180000);
  const t0 = Date.now();
  for (let i = 0; i < 60 && !visto.redeems.length; i++) await new Promise((r) => setTimeout(r, 500));
  console.log('[diag] riscatti:', JSON.stringify(visto), 'dopo ms', Date.now() - t0);

  await new Promise((r) => setTimeout(r, 12000));
  const finestre = app.windows().map((w) => { try { return w.url(); } catch (_) { return '?'; } });
  console.log('[diag] finestre:', JSON.stringify(finestre, null, 1));

  const home = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; } });
  if (!home) { console.log('[diag] nessuna home'); return; }
  const info = await home.evaluate(() => ({
    host: Boolean(document.querySelector('.sn-confirm-host')),
    ui: Boolean(window.SN_CONFIRM_UI),
    stato: (window.SN_CONFIRM_UI && window.SN_CONFIRM_UI._test && window.SN_CONFIRM_UI._test.state()) || null,
    testo: (document.body.innerText || '').slice(0, 900),
  })).catch((e) => ({ errore: String(e) }));
  console.log('[diag] home:', JSON.stringify(info, null, 1));

  const stato = await home.evaluate(async () => {
    try { return await chrome.runtime.sendMessage({ type: 'FILO_WALLET_STATE' }); } catch (e) { return { errore: String(e) }; }
  }).catch((e) => ({ errore: String(e) }));
  console.log('[diag] stato portafoglio dalla home:', JSON.stringify(stato).slice(0, 700));
});
